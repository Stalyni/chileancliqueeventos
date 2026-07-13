export const EVENTS = Object.freeze([
  Object.freeze({
    id: 'santiago',
    regionId: 'CL-RM',
    city: 'Santiago',
    region: 'Región Metropolitana',
    venue: 'COCO CAFE',
    address: 'Sexta Av. 1197, San Miguel',
    date: '2026-08-22T15:00:00-04:00',
    dateLabel: '22 de agosto de 2026',
    timeLabel: '15:00 hrs',
    panelSide: 'right',
    active: true
  }),
  Object.freeze({
    id: 'concepcion',
    regionId: 'CL-BI',
    city: 'Concepción',
    region: 'Región del Biobío',
    venue: 'Inugami',
    address: 'Lincoyán 23',
    date: '2026-08-15T15:30:00-04:00',
    dateLabel: '15 de agosto de 2026',
    timeLabel: '15:30 hrs',
    panelSide: 'left',
    active: true
  }),
  Object.freeze({
    id: 'vina-del-mar',
    regionId: 'CL-VS',
    city: 'Viña del Mar',
    region: 'Región de Valparaíso',
    venue: 'Café Con Letras',
    address: '7 Norte 610',
    date: '2026-08-29T15:00:00-04:00',
    dateLabel: '29 de agosto de 2026',
    timeLabel: '15:00 hrs',
    panelSide: 'top',
    active: true
  }),
  Object.freeze({
    id: 'temuco',
    regionId: 'CL-AR',
    city: 'Temuco',
    region: 'Región de La Araucanía',
    venue: 'Nobu Coffee Shop',
    address: 'Volcán Antuco 1581',
    date: '2026-08-29T15:00:00-04:00',
    dateLabel: '29 de agosto de 2026',
    timeLabel: '15:00 hrs',
    panelSide: 'top',
    active: true
  })
]);

export const EVENTS_BY_REGION = new Map(
  EVENTS.filter((event) => event.active).map((event) => [event.regionId, event])
);
