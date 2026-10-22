# Lime's Blender jobs, run headless: blender -b --factory-startup --python blender.py -- '<json>'
# The JSON names the job ("op"): convert a model, render a still, or render a turntable's frames.
# Only formats Blender 4.2+ reads and writes without add-ons are used, so the bundled LTS needs nothing online.
import bpy, json, math, os, sys
from mathutils import Vector

job = json.loads(sys.argv[sys.argv.index('--') + 1])
# STL, OBJ and PLY carry no units: Lime reads them as millimetres, and Blender works in metres.
MM = 0.001
EXT = lambda p: os.path.splitext(p)[1].lower().lstrip('.')


def say(**kw):
    print('LIME ' + json.dumps(kw), flush=True)


def empty():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def load(p):
    e = EXT(p)
    if e == 'blend':
        bpy.ops.wm.open_mainfile(filepath=p, load_ui=False)
        return
    empty()
    if e in ('glb', 'gltf'): bpy.ops.import_scene.gltf(filepath=p)
    elif e == 'fbx': bpy.ops.import_scene.fbx(filepath=p)
    elif e == 'obj': bpy.ops.wm.obj_import(filepath=p, global_scale=MM)
    elif e == 'stl': bpy.ops.wm.stl_import(filepath=p, global_scale=MM)
    elif e == 'ply': bpy.ops.wm.ply_import(filepath=p, global_scale=MM)
    elif e in ('usd', 'usda', 'usdc', 'usdz'): bpy.ops.wm.usd_import(filepath=p)
    elif e == 'abc': bpy.ops.wm.alembic_import(filepath=p, as_background_job=False)
    else: raise SystemExit('Blender can’t read .%s files' % e)


def save(p, opts):
    e = EXT(p)
    sel = {'use_selection': False}
    if e in ('glb', 'gltf'):
        bpy.ops.export_scene.gltf(filepath=p, export_format='GLB' if e == 'glb' else 'GLTF_EMBEDDED', export_apply=True)
    elif e == 'fbx':
        bpy.ops.export_scene.fbx(filepath=p, path_mode='COPY', embed_textures=True, apply_scale_options='FBX_SCALE_ALL', **sel)
    elif e == 'obj': bpy.ops.wm.obj_export(filepath=p, export_selected_objects=False, global_scale=1 / MM)
    elif e == 'stl': bpy.ops.wm.stl_export(filepath=p, export_selected_objects=False, global_scale=1 / MM)
    elif e == 'ply': bpy.ops.wm.ply_export(filepath=p, export_selected_objects=False, global_scale=1 / MM)
    elif e in ('usd', 'usda', 'usdc', 'usdz'): bpy.ops.wm.usd_export(filepath=p, selected_objects_only=False)
    elif e == 'abc': bpy.ops.wm.alembic_export(filepath=p, selected=False, as_background_job=False)
    elif e == 'blend': bpy.ops.wm.save_as_mainfile(filepath=p, compress=True)
    else: raise SystemExit('Blender can’t write .%s files' % e)


def meshes():
    return [o for o in bpy.context.scene.objects if o.type in ('MESH', 'CURVE', 'SURFACE', 'META', 'FONT') and not o.hide_render]


def bounds():
    deps = bpy.context.evaluated_depsgraph_get()
    lo, hi = Vector((1e30,) * 3), Vector((-1e30,) * 3)
    for o in meshes():
        ev = o.evaluated_get(deps)
        for c in ev.bound_box:
            w = ev.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    if lo.x > hi.x: raise SystemExit('There is nothing to render in this file.')
    return lo, hi


def stage(opts):
    """A camera aimed at the model from the front, three-quarters up, with soft studio light."""
    scene = bpy.context.scene
    lo, hi = bounds()
    centre, size = (lo + hi) / 2, max((hi - lo).length, 1e-6)
    own = opts.get('ownCamera') and scene.camera is not None
    if not own:
        cam = bpy.data.objects.new('Lime camera', bpy.data.cameras.new('Lime camera'))
        scene.collection.objects.link(cam)
        cam.data.lens = 50
        cam.data.clip_start, cam.data.clip_end = size / 1000, size * 100
        scene.camera = cam
    if not own or opts.get('turntable'):
        rig = bpy.data.objects.new('Lime turntable', None)
        scene.collection.objects.link(rig)
        rig.location = centre
        cam = scene.camera
        if not own:
            # Far enough that the model's bounding sphere fits the narrower side of the picture, with a margin.
            w, h = int(opts.get('width') or 1600), int(opts.get('height') or 1200)
            half = math.atan(18 / 50 * min(w, h) / max(w, h))
            dist = size / 2 / math.sin(half) * 1.08
            cam.parent = rig
            cam.location = Vector((math.sin(math.radians(35)), -math.cos(math.radians(35)), 0.55)).normalized() * dist
            track = cam.constraints.new('TRACK_TO'); track.target = rig; track.track_axis = 'TRACK_NEGATIVE_Z'; track.up_axis = 'UP_Y'
        else:
            mw = cam.matrix_world.copy(); cam.parent = rig; cam.matrix_world = mw
    if not opts.get('ownLights') or not any(o.type == 'LIGHT' for o in scene.objects):
        for name, rot, energy, sz in (('Key', (45, 0, 30), 2.6, 2.0), ('Fill', (70, 0, -70), 0.5, 4.0), ('Rim', (110, 0, 160), 1.6, 1.0)):
            ld = bpy.data.lights.new('Lime ' + name, 'SUN'); ld.energy = energy; ld.angle = math.radians(sz * 5)
            lo_ = bpy.data.objects.new('Lime ' + name, ld); lo_.rotation_euler = tuple(math.radians(a) for a in rot)
            scene.collection.objects.link(lo_)
        if scene.world is None: scene.world = bpy.data.worlds.new('Lime')
        scene.world.use_nodes = True
        bg = scene.world.node_tree.nodes.get('Background')
        if bg: bg.inputs[0].default_value = (0.8, 0.82, 0.85, 1); bg.inputs[1].default_value = 0.3
    scene.frame_set(scene.frame_current)
    return scene


def engine(scene, opts, turntable=False):
    want = opts.get('engine') or 'cycles'
    ids = [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
    if want == 'eevee':
        scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in ids else 'BLENDER_EEVEE'
        try: scene.eevee.taa_render_samples = int(opts.get('samples') or (16 if turntable else 64))
        except Exception: pass
    else:
        scene.render.engine = 'CYCLES'
        c = scene.cycles
        c.device = 'CPU'
        c.samples = int(opts.get('samples') or (16 if turntable else 96))
        c.use_denoising = True
        try: c.denoiser = 'OPENIMAGEDENOISE'
        except Exception: pass
        c.use_adaptive_sampling = True
    r = scene.render
    w, h = int(opts.get('width') or 1600), int(opts.get('height') or 1200)
    r.resolution_x, r.resolution_y, r.resolution_percentage = w, h, 100
    r.film_transparent = opts.get('background') == 'transparent'
    r.image_settings.file_format = 'PNG'
    r.image_settings.color_mode = 'RGBA' if r.film_transparent else 'RGB'
    if opts.get('background') == 'white' and scene.world:
        bg = scene.world.node_tree.nodes.get('Background') if scene.world.use_nodes else None
        if bg: bg.inputs[0].default_value = (1, 1, 1, 1); bg.inputs[1].default_value = 1.0
    try: scene.view_settings.view_transform = 'AgX' if 'AgX' in [i.identifier for i in scene.view_settings.bl_rna.properties['view_transform'].enum_items] else 'Filmic'
    except Exception: pass


op = job['op']
if op == 'convert':
    load(job['in'])
    save(job['out'], job)
    say(ok=True, out=job['out'])
elif op == 'render':
    load(job['in'])
    scene = stage(job)
    engine(scene, job)
    scene.render.filepath = job['out']
    bpy.ops.render.render(write_still=True)
    say(ok=True, out=job['out'])
elif op == 'turntable':
    load(job['in'])
    job['turntable'] = True
    scene = stage(job)
    engine(scene, job, turntable=True)
    rig = bpy.data.objects['Lime turntable']
    frames = int(job.get('frames') or 72)
    scene.frame_start, scene.frame_end = 1, frames
    for f in range(1, frames + 1):
        scene.frame_set(f)
        rig.rotation_euler = (0, 0, math.tau * (f - 1) / frames)
        scene.render.filepath = os.path.join(job['out'], 'frame-%04d.png' % f)
        bpy.ops.render.render(write_still=True)
        say(frame=f, of=frames)
    say(ok=True, out=job['out'])
else:
    raise SystemExit('Unknown job ' + op)
