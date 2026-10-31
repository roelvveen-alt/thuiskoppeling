import {
  CarFront,
  CookingPot,
  Droplets,
  EvCharger,
  Heater,
  House,
  Lamp,
  Monitor,
  Plug,
  Refrigerator,
  Sun,
  Thermometer,
  Tv,
  UtilityPole,
  Utensils,
  WashingMachine,
} from 'lucide-react';
import { createElement } from 'react';
import { streepjesVoor } from '@/lib/ringen';

/**
 * De batterij met vier streepjes: hoe vol hij is (0, 25, 50, 75, 100%). In de
 * stijl van de lucide-iconen (die hebben er hooguit drie). Zonder percentage,
 * bijvoorbeeld in een lijst bij Instellingen, een gewone halfvolle batterij.
 * Alleen de volle streepjes staan erin: bij 10% is hij dus (bijna) leeg, zoals hij echt is.
 */
export function BatterijIcoon({ procent, size = 24, strokeWidth = 2, ...rest }) {
  const vol = streepjesVoor(procent) ?? 2;
  return createElement(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'data-streepjes': vol,
      ...rest,
    },
    createElement('rect', { x: 1.5, y: 6.5, width: 18, height: 11, rx: 2 }),
    createElement('path', { d: 'M22.5 10.5v3' }),
    // Alleen de volle streepjes (bij 10% leek hij met vage lege streepjes vol): leeg is echt leeg.
    ...[0, 1, 2, 3].slice(0, vol).map((i) =>
      createElement('rect', {
        key: i,
        x: 4 + i * 3.6,
        y: 9.5,
        width: 2.4,
        height: 5,
        rx: 0.6,
        fill: 'currentColor',
        stroke: 'none',
      }),
    ),
  );
}

/** Welk plaatje bij een apparaat hoort. De soort komt uit de instellingen van het programmaatje thuis. */
const APPARAAT = {
  wasmachine: WashingMachine,
  droger: WashingMachine,
  vaatwasser: Utensils,
  koelkast: Refrigerator,
  vriezer: Refrigerator,
  laadpaal: EvCharger,
  auto: CarFront,
  warmtepomp: Heater,
  boiler: Droplets,
  kookplaat: CookingPot,
  oven: CookingPot,
  tv: Tv,
  computer: Monitor,
  lamp: Lamp,
  verwarming: Thermometer,
  // Een pomp (Tuya-meetschakelaar, programmaatje 0.8.0).
  pomp: Droplets,
};

export function icoonVoor(punt) {
  if (punt?.soort === 'zon') return Sun;
  if (punt?.soort === 'batterij') return BatterijIcoon;
  if (punt?.soort === 'net') return UtilityPole;
  if (punt?.soort === 'huis') return House;
  return APPARAAT[punt?.icoon] ?? Plug;
}

/**
 * Het plaatje van een punt. Via createElement: icoonVoor geeft altijd een van
 * de vaste componenten terug, dus er wordt niets opnieuw aangemaakt. `procent`
 * (alleen bij de batterij) zet de streepjes; de andere iconen negeren het.
 */
export function PuntIcoon({ punt, procent, ...rest }) {
  const Icoon = icoonVoor(punt);
  return createElement(Icoon, { 'aria-hidden': 'true', ...(Icoon === BatterijIcoon ? { procent } : {}), ...rest });
}
