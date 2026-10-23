// A small semantic vocabulary, not arbitrary SVG, code, or decorative icons.
// These figures occupy an independent stage above their labels. Status is
// authored explanation only: it never writes business state or proves success.
export const EDITORIAL_ILLUSTRATIONS = Object.freeze({
  processor: ['neutral', 'working'],
  gate: ['neutral', 'closed', 'open'],
  archive: ['neutral', 'selected'],
  monitor: ['neutral', 'five', 'twenty'],
  parcel: ['neutral'],
  deadline: ['neutral', 'over'],
  modules: ['neutral', 'separate', 'combined'],
  trace: ['neutral', 'selected'],
  meter: ['neutral', 'within', 'over'],
});

export function validEditorialIllustration(type,variant='neutral') {
  return Object.hasOwn(EDITORIAL_ILLUSTRATIONS,type) && EDITORIAL_ILLUSTRATIONS[type].includes(variant);
}
