# Writes a small HDF5 file laid out like a HEC-RAS 6 plan results file (p01.hdf): eight cross sections on one reach,
# two steady profiles and a 6-hour unsteady hydrograph. Usage: python3 rasfixture.py out.hdf
import sys, math
import numpy as np
import h5py

out = sys.argv[1]
rs = [1000, 900, 800, 700, 600, 500, 400, 300]
n = len(rs)
inv = [12.0 - 0.9 * i for i in range(n)]                 # channel invert, metres
with h5py.File(out, 'w', libver='earliest') as f:
    f.attrs['File Type'] = np.bytes_('HEC-RAS Results')
    f.attrs['File Version'] = np.bytes_('HEC-RAS 6.5 February 2024')
    pi = f.create_group('Plan Data/Plan Information')
    pi.attrs['Plan Title'] = np.bytes_('Wadi channel 100-year')
    pi.attrs['Plan ShortID'] = np.bytes_('Q100')
    pi.attrs['Flow Title'] = np.bytes_('Design storms')
    pi.attrs['Simulation Start Time'] = np.bytes_('01Jan2024 00:00:00')
    dt = np.dtype([('River', 'S16'), ('Reach', 'S16'), ('RS', 'S8'), ('Name', 'S16'), ('Len Left', '<f4'), ('Len Channel', '<f4'), ('Len Right', '<f4'), ('Left Bank', '<f4'), ('Right Bank', '<f4')])
    attrs = np.array([(b'Wadi Hatta', b'Main', str(r).encode(), b'', 100, 100, 100, 20, 60) for r in rs], dtype=dt)
    xs = f.create_group('Geometry/Cross Sections')
    xs.create_dataset('Attributes', data=attrs)
    info, vals = [], []
    for i in range(n):
        pts = [(0, inv[i] + 4), (20, inv[i] + 1.5), (30, inv[i]), (50, inv[i]), (60, inv[i] + 1.5), (80, inv[i] + 4.2)]
        info.append((len(vals), len(pts)))
        vals.extend(pts)
    xs.create_dataset('Station Elevation Info', data=np.array(info, dtype='<i4'))
    xs.create_dataset('Station Elevation Values', data=np.array(vals, dtype='<f4'))
    st = f.create_group('Results/Steady/Output/Output Blocks/Base Output/Steady Profiles')
    st.create_dataset('Profile Names', data=np.array([b'PF 10yr', b'PF 100yr'], dtype='S16'))
    sx = st.create_group('Cross Sections')
    depth = [[1.2 + 0.05 * i for i in range(n)], [2.1 + 0.07 * i for i in range(n)]]
    sx.create_dataset('Water Surface', data=np.array([[inv[i] + d[i] for i in range(n)] for d in depth], dtype='<f4'))
    sx.create_dataset('Flow', data=np.array([[85.0] * n, [190.0] * n], dtype='<f4'))
    sx.create_dataset('Velocity Total', data=np.array([[1.6 + 0.02 * i for i in range(n)], [2.2 + 0.03 * i for i in range(n)]], dtype='<f4'))
    un = f.create_group('Results/Unsteady/Output/Output Blocks/Base Output/Unsteady Time Series')
    T = 25
    stamps = [('01JAN2024 %02d:%02d:00' % (t * 15 // 60, t * 15 % 60)).encode() for t in range(T)]
    un.create_dataset('Time Date Stamp', data=np.array(stamps, dtype='S19'))
    q = [5 + 185 * math.exp(-((t - 10) / 4.0) ** 2) for t in range(T)]
    ux = un.create_group('Cross Sections')
    ux.create_dataset('Flow', data=np.array([[q[max(0, t - i // 3)] for i in range(n)] for t in range(T)], dtype='<f4'))
    ux.create_dataset('Water Surface', data=np.array([[inv[i] + 0.4 + 2.0 * (q[max(0, t - i // 3)] / 190.0) ** 0.6 for i in range(n)] for t in range(T)], dtype='<f4'))
    ux.create_dataset('Velocity Total', data=np.array([[0.5 + 1.8 * (q[max(0, t - i // 3)] / 190.0) ** 0.4 for i in range(n)] for t in range(T)], dtype='<f4'))
print(out)
