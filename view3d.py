import numpy as np
import napari

img = np.load('recon.npy')

viewer = napari.Viewer()
viewer.add_image(img[..., 0], blending='additive', colormap='r')
viewer.add_image(img[..., 1], blending='additive', colormap='g')
napari.run()