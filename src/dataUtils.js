// example data handling functions

// Normalize an array of values to [0, 1]
export function normalizeArray(arr) {
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  return arr.map(val => (max - min === 0 ? 0 : (val - min) / (max - min)));
}

// Map a normalized value [0,1] to a color (simple gradient)
export function valueToColor(val) {
  const r = Math.floor(255 * val);
  const g = Math.floor(255 * (1 - val));
  return `rgb(${r},${g},0)`;
}

// Check if a data sample is valid
export function isValidSample(sample) {
  return sample && typeof sample === "object" && sample.data;
}