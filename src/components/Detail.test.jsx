import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LEGE_OPSTELLING, puntenVoor, zetNaam } from '@/lib/opstelling';
import { verdeelStroom } from '@/lib/stroom';
import Detail from './Detail';

const tekst = (html) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|\s/g, ' ')
    .replace(/ +/g, ' ')
    .trim();

const TIM = {
  zon_w: 1134,
  zonnen: [
    { sleutel: 'hw-zon-batterij', naam: 'zon + batterij', vermogen_w: 701 },
    { sleutel: 'hw-zon-dierenverblijf', naam: 'Zon dierenverblijf', vermogen_w: 433 },
  ],
  batterij_w: -627,
  batterij_procent: 7,
  net_w: -49,
  apparaten: [],
};
const punten = puntenVoor(zetNaam(LEGE_OPSTELLING, 'hw-zon-batterij', 'Hoofddak'), TIM);
const blad = (sleutel) =>
  tekst(renderToStaticMarkup(<Detail punt={punten.find((p) => p.sleutel === sleutel)} punten={punten} stand={TIM} verdeling={verdeelStroom(TIM)} onSluit={() => {}} />));
const KETEN = 'De zon levert 1.134 W (Hoofddak 701 W + Dierenverblijf 433 W). Daarvan laadt 627 W de batterij en gebruikt je huis 458 W. De rest, 49 W, gaat naar het net.';

describe('de bladen: kort, zonder Nu in woorden (dat staat op Huis)', () => {
  it('het huisblad: waar het huis van draait en wat er door de meterkast gaat', () => {
    const t = blad('huis');
    expect(t).toContain('Je huis draait nu helemaal op de zon.');
    expect(t).toContain('Door de meterkast naar Batterij 627 W');
    expect(t).not.toContain(KETEN);
    expect(t).not.toContain('Nu in woorden');
    expect(t).not.toContain('alles bij elkaar');
    expect(t).not.toContain('Door je meterkast komt nu');
  });

  it('het zonneblad: waar déze plek heen gaat', () => {
    const t = blad('hw-zon-batterij');
    expect(t).toContain('Van de 701 W gaat 388 W naar de batterij, 283 W naar het huis en 30 W naar het net.');
    expect(t).not.toContain(KETEN);
  });

  it('het batterijblad zegt het laden één keer, en hoe vol hij is alleen in de titel', () => {
    const t = blad('batterij');
    expect(t).toContain('Batterij 7%');
    expect(t).toContain('De batterij laadt met 627 W, allemaal van de zon.');
    expect(t).not.toContain('voor 7% vol');
    expect(t).not.toContain('Nu in woorden');
  });

  it('een percentage alleen bij twee of meer regels, en nooit bij de meterkast', () => {
    expect(blad('huis')).not.toMatch(/Batterij 627 W \d+%/);
    expect(blad('batterij')).not.toContain('100%');
    expect(blad('hw-zon-batterij')).toMatch(/\d+%/);
  });

  it('het netblad: binnen ±20 W "bijna niets", zonder regel over een stroom', () => {
    const stand = { ...TIM, batterij_w: -620, net_w: -14 };
    const p = puntenVoor(LEGE_OPSTELLING, stand);
    const t = tekst(renderToStaticMarkup(<Detail punt={p.find((x) => x.sleutel === 'net')} punten={p} stand={stand} verdeling={verdeelStroom(stand)} onSluit={() => {}} />));
    expect(t).toContain('Er gaat bijna niets naar of uit het net');
    expect(t).not.toContain('Komt van');
  });
});

describe('de spanning op het blad van het net en van het huis (Tim)', () => {
  const MET_SPANNING = { ...TIM, fasen: [{ fase: 1, w: -17, a: 0.1, v: 233 }, { fase: 2, w: -154, a: 0.7, v: 251 }, { fase: 3, w: 1535, a: 6.7, v: 229 }] };
  const blad2 = (soort, stand) => {
    const p = puntenVoor(LEGE_OPSTELLING, stand);
    return renderToStaticMarkup(<Detail punt={p.find((x) => x.soort === soort)} punten={p} stand={stand} verdeling={verdeelStroom(stand)} onSluit={() => {}} />);
  };
  it('net en huis: per fase de spanning, boven 250 V in de let-op-kleur, met waar hij vandaan komt', () => {
    for (const soort of ['net', 'huis']) {
      const html = blad2(soort, MET_SPANNING);
      expect(tekst(html), soort).toMatch(/Spanning nu L1 233 V L2 251 V L3 229 V Gemeten door de slimme meter\./);
      expect(html).toMatch(/text-let-op">L2/);
    }
  });
  it('zonder spanning: geen kopje', () => {
    expect(tekst(blad2('net', TIM))).not.toMatch(/Spanning nu/);
  });
});
