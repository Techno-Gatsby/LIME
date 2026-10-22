#!/usr/bin/env python3
# Builds Lime's upscale and object-removal models as ONNX from the published PyTorch weights, without PyTorch:
# the weight files are read as the zip-of-pickles they are, and each network is written out layer by layer.
# Needs numpy and onnx. Called by scripts/engines.mjs; the weights' URLs and SHA-256 are pinned there.
import sys, re, math, pickle, zipfile, numpy as np, onnx
DT = {'FloatStorage': np.float32, 'HalfStorage': np.float16, 'LongStorage': np.int64, 'IntStorage': np.int32, 'DoubleStorage': np.float64, 'BoolStorage': np.bool_, 'ByteStorage': np.uint8}
class Obj:
    def __init__(self, *a): self._qual = None
    def __setstate__(self, s): self.__dict__.update(s if isinstance(s, dict) else {'_state': s})
def load(path, pkl='data.pkl'):
    z = zipfile.ZipFile(path)
    names = z.namelist(); root = names[0].split('/')[0]
    def rebuild(storage, offset, size, stride, *rest):
        a = storage
        if not size: return a[offset].copy()
        item = a.itemsize
        return np.lib.stride_tricks.as_strided(a[offset:], shape=size, strides=[s * item for s in stride]).copy()
    class U(pickle.Unpickler):
        def find_class(self, mod, name):
            if mod == 'torch._utils' and name == '_rebuild_tensor_v2': return rebuild
            if mod == 'torch' and name.endswith('Storage'): return name
            if mod == 'collections' and name == 'OrderedDict': import collections; return collections.OrderedDict
            if mod.startswith('__torch__'):
                return type(name, (Obj,), {'_qual': f'{mod}.{name}'})
            if mod == 'torch' and name == 'device': return str
            raise pickle.UnpicklingError(f'{mod}.{name}')
        def persistent_load(self, pid):
            _, kind, key, loc, numel = pid[:5]
            raw = z.read(f'{root}/data/{key}') if pkl == 'data.pkl' else z.read(f'{root}/constants/{key}')
            return np.frombuffer(raw, dtype=DT[kind])
    return U(z.open(f'{root}/{pkl}')).load(), z, root

from onnx import helper as oh, TensorProto as TP, numpy_helper as nh

class G:
    def __init__(s, store='fp32'): s.nodes, s.inits, s.n, s.store = [], [], 0, store
    def name(s, p='t'): s.n += 1; return f'{p}{s.n}'
    def const(s, a, p='c'):
        n = s.name(p); s.inits.append(nh.from_array(np.asarray(a), n)); return n
    def op(s, t, ins, outs=1, **kw):
        o = [s.name(t.lower()) for _ in range(outs)]
        s.nodes.append(oh.make_node(t, ins, o, **kw)); return o[0] if outs == 1 else o
    def weight(s, w, axis=0, fine=False):
        w = np.asarray(w, np.float32)
        if (s.store == 'fp16' or (s.store == 'mixed' and fine)) and w.ndim >= 2: return s.op('Cast', [s.const(w.astype(np.float16), 'w')], to=TP.FLOAT)
        if s.store in ('int8', 'mixed') and w.ndim >= 2:
            red = tuple(i for i in range(w.ndim) if i != axis)
            sc = np.maximum(np.abs(w).max(axis=red), 1e-12) / 127
            q = np.clip(np.round(w / sc.reshape([-1 if i == axis else 1 for i in range(w.ndim)])), -127, 127).astype(np.int8)
            return s.op('DequantizeLinear', [s.const(q, 'w'), s.const(sc.astype(np.float32), 's'), s.const(np.zeros_like(q, shape=sc.shape), 'z')], axis=axis)
        return s.const(w, 'w')
    def conv(s, x, w, b=None, stride=1, pad=0, reflect=0, groups=1, fine=False):
        if reflect: x = s.op('Pad', [x, s.const(np.array([0, 0, reflect, reflect, 0, 0, reflect, reflect], np.int64))], mode='reflect')
        ins = [x, s.weight(w, fine=fine)] + ([s.const(np.asarray(b, np.float32), 'b')] if b is not None else [])
        k = w.shape[2:]
        return s.op('Conv', ins, kernel_shape=list(k), strides=[stride, stride], pads=[pad] * 4, group=groups)
    def model(s, inputs, outputs, opset=17):
        g = oh.make_graph(s.nodes, 'm', inputs, outputs, s.inits)
        m = oh.make_model(g, opset_imports=[oh.make_opsetid('', opset)], producer_name='lime')
        m.ir_version = 8
        return m

def io(name, shape): return oh.make_tensor_value_info(name, TP.FLOAT, shape)

def compact(sd, store):
    g = G(store); n = max(int(k.split('.')[1]) for k in sd); x = 'input'
    for i in range(0, n + 1):
        w = sd.get(f'body.{i}.weight')
        if w.ndim == 4: x = g.conv(x, w, sd[f'body.{i}.bias'], pad=1)
        else: x = g.op('PRelu', [x, g.const(w.reshape(-1, 1, 1).astype(np.float32))])
    x = g.op('DepthToSpace', [x], blocksize=4, mode='CRD')
    base = g.op('Resize', ['input', '', g.const(np.array([1, 1, 4, 4], np.float32))], mode='nearest')
    g.nodes.append(oh.make_node('Clip', [g.op('Add', [x, base]), g.const(np.float32(0)), g.const(np.float32(1))], ['output']))
    return g.model([io('input', ['n', 3, 'h', 'w'])], [io('output', ['n', 3, 'H', 'W'])])

# LaMa (big-lama, scripted by IOPaint): walk the module tree; each conv's padding and stride come from its scripted code.
def lama(path, store, size=512):
    root, z, top = load(path)
    consts, _, _ = load(path, 'constants.pkl')
    assert [int(c) for c in consts] == [0, 1], consts
    code = {}
    def src(o):
        q = type(o)._qual
        f = f'{top}/code/' + '/'.join(q.split('.')[:-1]) + '.py'
        if f not in code: code[f] = z.read(f).decode()
        return next(c for c in re.findall(r'class \w+\(Module\):.*?(?=\nclass |\Z)', code[f], re.S) if f'self: {q},' in c)
    kind = lambda o: None if o is None else type(o)._qual.split('.')[-1]
    g = G(store)
    def conv(m, x):
        t = src(m)
        rp = re.search(r'reflection_pad2d\(\w+, \[(\d+), \d+, \d+, \d+\]\)', t)
        cv = re.search(r'_convolution\(\w+, [\w.]+, [\w.]+, \[(\d+), \d+\], \[(\d+), \d+\], \[1, 1\], (True|False), \[(\d+), \d+\], (\d+)', t)
        stride, pad, tr, opad, groups = int(cv[1]), int(cv[2]), cv[3] == 'True', int(cv[4]), int(cv[5])
        b = getattr(m, 'bias', None)
        if tr:
            ins = [x, g.weight(m.weight, axis=1, fine=True), g.const(b.astype(np.float32), 'b')]
            k = m.weight.shape[2:]
            return g.op('ConvTranspose', ins, kernel_shape=list(k), strides=[stride] * 2, pads=[pad] * 4, output_padding=[opad] * 2)
        return g.conv(x, m.weight, b, stride=stride, pad=pad, reflect=int(rp[1]) if rp else 0, groups=groups, fine=m.weight.shape[2] > 3)
    def bn(m, x):
        return g.op('BatchNormalization', [x, g.const(m.weight.astype(np.float32)), g.const(m.bias.astype(np.float32)), g.const(m.running_mean.astype(np.float32)), g.const(m.running_var.astype(np.float32))], epsilon=1e-5)
    def mod(m, x):
        k = kind(m)
        if k in (None, 'Identity'): return x
        if k in ('Conv2d', 'ConvTranspose2d'): return conv(m, x)
        if k == 'BatchNorm2d': return bn(m, x)
        if k == 'ReLU': return g.op('Relu', [x])
        if k == 'Sigmoid': return g.op('Sigmoid', [x])
        if k == 'ReflectionPad2d':
            p = int(re.search(r'reflection_pad2d\(\w+, \[(\d+)', src(m))[1])
            return g.op('Pad', [x, g.const(np.array([0, 0, p, p, 0, 0, p, p], np.int64))], mode='reflect')
        if k == 'Sequential':
            for i in sorted((int(a) for a in m.__dict__ if a.isdigit())): x = mod(getattr(m, str(i)), x)
            return x
        if k == 'FFC_BN_ACT':
            l, gl = ffc(m.ffc, x)
            l = mod(m.act_l, mod(m.bn_l, l))
            return l if gl is None else (l, mod(m.act_g, mod(m.bn_g, gl)))
        if k == 'FFCResnetBlock':
            y = mod(m.conv2, mod(m.conv1, x))
            return (g.op('Add', [x[0], y[0]]), g.op('Add', [x[1], y[1]]))
        if k == 'ConcatTupleLayer': return g.op('Concat', list(x), axis=1)
        if k == 'SpectralTransform':
            assert kind(m.downsample) == 'Identity' and not hasattr(m, 'lfu')
            y = mod(m.conv1, x)
            return mod(m.conv2, g.op('Add', [y, fourier(m.fu, y)]))
        raise ValueError(k)
    def ffc(m, x):
        xl, xg = x if isinstance(x, tuple) else (x, None)
        terms = lambda *ps: [mod(c, v) for c, v in ps if kind(c) not in (None, 'Identity') and v is not None]
        sum_ = lambda ts: None if not ts else ts[0] if len(ts) == 1 else g.op('Add', ts)
        assert kind(m.gate) == 'Identity'
        return sum_(terms((m.convl2l, xl), (m.convg2l, xg))), sum_(terms((m.convl2g, xl), (m.convg2g, xg)))
    # rfftn/irfftn ("ortho") over a fixed H×W, written as real matrix products.
    H = W = size // 8; V = W // 2 + 1
    hh, uu = np.meshgrid(np.arange(H), np.arange(H), indexing='ij'); ww, vv = np.meshgrid(np.arange(W), np.arange(V), indexing='ij')
    Ch, Sh = np.cos(2 * np.pi * hh * uu / H), np.sin(2 * np.pi * hh * uu / H)
    Cw, Sw = np.cos(2 * np.pi * ww * vv / W), np.sin(2 * np.pi * ww * vv / W)
    cv = np.full(V, 2.0); cv[0] = 1; cv[-1] = 1 if W % 2 == 0 else 2
    k = 1 / math.sqrt(H * W)
    mats = {}
    def M(n, a):
        if n not in mats: mats[n] = g.const(a if a.dtype.kind in 'iu' else a.astype(np.float32), n)
        return mats[n]
    def fourier(m, x):
        A = g.op('MatMul', [x, M('cw', Cw * k)]); B = g.op('MatMul', [x, M('nsw', -Sw * k)])
        mm = lambda a, b: g.op('MatMul', [a, b])
        re_ = g.op('Add', [mm(M('ch', Ch), A), mm(M('sh', Sh), B)]); im_ = g.op('Sub', [mm(M('ch', Ch), B), mm(M('sh', Sh), A)])
        c = m.conv_layer.weight.shape[1] // 2
        st = g.op('Concat', [g.op('Unsqueeze', [re_, M('ax2', np.array([2], np.int64))]), g.op('Unsqueeze', [im_, M('ax2', np.array([2], np.int64))])], axis=2)
        y = g.op('Reshape', [st, M(f'r{c}', np.array([0, 2 * c, H, V], np.int64))])
        y = mod(m.relu, mod(m.bn, conv(m.conv_layer, y)))
        co = m.conv_layer.weight.shape[0] // 2
        y = g.op('Reshape', [y, M(f'q{co}', np.array([0, co, 2, H, V], np.int64))])
        yr, yi = g.op('Split', [y], outs=2, axis=2)
        yr = g.op('Squeeze', [yr, M('ax2', np.array([2], np.int64))]); yi = g.op('Squeeze', [yi, M('ax2', np.array([2], np.int64))])
        zr = g.op('Sub', [mm(M('ch', Ch), yr), mm(M('sh', Sh), yi)]); zi = g.op('Add', [mm(M('ch', Ch), yi), mm(M('sh', Sh), yr)])
        return g.op('Sub', [mm(zr, M('cw2', (cv[:, None] * Cw.T) * k)), mm(zi, M('sw2', (cv[:, None] * Sw.T) * k))])
    # image 0..1 RGB, mask 1 = fill; same wrapper as the scripted module
    inv = g.op('Sub', [g.const(np.float32(1)), 'mask'])
    x = g.op('Concat', [g.op('Mul', ['image', inv]), 'mask'], axis=1)
    out = mod(root.generator.model, x)
    g.nodes.append(oh.make_node('Add', [g.op('Mul', ['mask', out]), g.op('Mul', [inv, 'image'])], ['output']))
    return g.model([io('image', [1, 3, size, size]), io('mask', [1, 1, size, size])], [io('output', [1, 3, size, size])])

if __name__ == '__main__':
    # Real-ESRGAN compact models keep 8-bit weights; LaMa keeps 16-bit weights for its 7×7 and up-sampling layers,
    # where 8 bits visibly hurt the fill, and 8-bit weights everywhere else.
    kind, src, out = sys.argv[1:4]
    if kind == 'lama': m = lama(src, 'mixed')
    else: m = compact(next(iter(load(src)[0].values())), 'int8')
    onnx.checker.check_model(m)
    onnx.save(m, out)
