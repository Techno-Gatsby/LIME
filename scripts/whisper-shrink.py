# Build step: the int8 Whisper decoder still keeps its token table in fp32 (dynamic quantisation skips
# Gather). Store it as int8 rows with one scale each and dequantise at load; the file shrinks by ~3/4 of
# the table. Usage: python3 whisper-shrink.py <decoder.onnx in> <decoder.onnx out>
import sys
import numpy as np
import onnx
from onnx import helper, numpy_helper

src, dst = sys.argv[1], sys.argv[2]
m = onnx.load(src)
g = m.graph
name = 'textDecoder.token_embedding.weight'
init = next((t for t in g.initializer if t.name == name), None)
if init is None or init.data_type != onnx.TensorProto.FLOAT:
    onnx.save(m, dst)
    sys.exit(0)
w = numpy_helper.to_array(init).astype(np.float32)
s = np.abs(w).max(axis=1) / 127.0
s[s == 0] = 1e-8
q = np.clip(np.round(w / s[:, None]), -127, 127).astype(np.int8)
g.initializer.remove(init)
g.initializer.extend([numpy_helper.from_array(q, name + '_q'), numpy_helper.from_array(s.astype(np.float32), name + '_s'), numpy_helper.from_array(np.zeros_like(s, dtype=np.int8), name + '_z')])
g.node.insert(0, helper.make_node('DequantizeLinear', [name + '_q', name + '_s', name + '_z'], [name], axis=0))
onnx.save(m, dst)
print('token table', w.nbytes, '->', q.nbytes + s.nbytes, 'bytes; mean error', float(np.abs(q * s[:, None] - w).mean()))
