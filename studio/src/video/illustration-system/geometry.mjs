export const ILLUSTRATION_GEOMETRY = Object.freeze({
  selection: Object.freeze({ sourceX: 230, sourceY: 380, rowGap: 145, sourceWidth: 320,
    context: Object.freeze({ x: 1150, y: 385, width: 560, height: 415 }),
    packet: Object.freeze({ width: 270, height: 120 }), destination: Object.freeze({ x: 1290, y: 535 }) }),
  request: Object.freeze({ caller: Object.freeze({ x: 200, y: 390, width: 430, height: 385 }),
    database: Object.freeze({ x: 1270, y: 390, width: 380, height: 365 }),
    packet: Object.freeze({ width: 176, height: 64 }), sendY: 510, returnY: 690,
    databaseFirstRowBaseline: 190, databaseRowGap: 69, returnTurnX: 1130 }),
  restore: Object.freeze({ known: Object.freeze({ x: 265, y: 410, width: 450, height: 410 }),
    current: Object.freeze({ x: 1195, y: 410, width: 450, height: 410 }),
    packet: Object.freeze({ width: 198, height: 64 }), transferY: 780 })
});

export const horizontalCenter = (bounds) => bounds.x + bounds.width / 2;

export function packetInsideObject(center, packet, object) {
  return center.x - packet.width / 2 >= object.x && center.x + packet.width / 2 <= object.x + object.width &&
    center.y - packet.height / 2 >= object.y && center.y + packet.height / 2 <= object.y + object.height;
}
