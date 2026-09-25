import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import type { VtkDataTypes } from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { DecodedVolume, ScalarEncoding } from '../types';

const vtkTypeByScalar: Record<ScalarEncoding, VtkDataTypes> = {
  uint8: vtkDataArray.VtkDataTypes.UNSIGNED_CHAR,
  int16: vtkDataArray.VtkDataTypes.SHORT,
  uint16: vtkDataArray.VtkDataTypes.UNSIGNED_SHORT,
  float32: vtkDataArray.VtkDataTypes.FLOAT,
};

const typedArrayByScalar: Record<
  ScalarEncoding,
  new (buffer: ArrayBuffer) => ArrayLike<number> & { buffer: ArrayBuffer }
> = {
  uint8: Uint8Array as never,
  int16: Int16Array as never,
  uint16: Uint16Array as never,
  float32: Float32Array as never,
};

export function createVtkImage(volume: DecodedVolume) {
  const { metadata, data } = volume;
  const TypedArray = typedArrayByScalar[metadata.scalarType];
  const imageData = vtkImageData.newInstance();
  imageData.setDimensions(metadata.dimensions);
  imageData.setSpacing(metadata.spacing);
  imageData.setOrigin(metadata.origin);

  const scalars = vtkDataArray.newInstance({
    name: 'HU',
    numberOfComponents: 1,
    dataType: vtkTypeByScalar[metadata.scalarType],
    values: new TypedArray(data),
  });
  imageData.getPointData().setScalars(scalars);
  return imageData;
}
