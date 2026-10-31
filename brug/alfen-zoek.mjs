#!/usr/bin/env node
import net from 'node:net';
import os from 'node:os';
import { netwerkenUit } from './zoek.mjs';

/**
 * Zoekt een Alfen-laadpaal in het eigen netwerk en leest hem één keer uit (31-10-2026: "kan jij kijken of je
 * de Alfen vindt en werkt?"). ALLEEN LEZEN: alleen Modbus-functie 3 (registers lezen); er gaat niets naar de paal
 * dat iets verandert, en niets naar internet.
 *
 *   node brug/alfen-zoek.mjs               zoekt in het netwerk van deze telefoon/computer
 *   node brug/alfen-zoek.mjs 192.168.1     zoekt in dat netwerk (de eerste drie getallen)
 *   node brug/alfen-zoek.mjs 192.168.1.40  leest alleen dat adres
 *
 * Alfen (Eve Single/Double Pro-line, "Modbus TCP/IP for Energy Management Systems"): poort 502. Unit 200 = de paal
 * (naam 100–116, fabrikant 117–121), unit 1 = de eerste aansluiting (vermogen 344–345, float32; laadstand 1201–1205,
 * tekst). Staat Modbus uit, dan is poort 502 dicht: dan moet de installateur het aanzetten (ACE Service Installer).
 */

const POORT = 502;
const WACHT_MS = 1500;

function vraag(adres, unit, register, aantal) {
  return new Promise((klaar, mis) => {
    const s = net.connect({ host: adres, port: POORT });
    const tijd = setTimeout(() => {
      s.destroy();
      mis(new Error('geen antwoord'));
    }, WACHT_MS);
    s.once('error', (e) => {
      clearTimeout(tijd);
      mis(e);
    });
    s.once('connect', () => {
      const v = Buffer.alloc(12);
      v.writeUInt16BE(1, 0); // transactie
      v.writeUInt16BE(0, 2); // protocol
      v.writeUInt16BE(6, 4); // lengte
      v.writeUInt8(unit, 6);
      v.writeUInt8(3, 7); // functie 3: registers lezen (alleen lezen)
      v.writeUInt16BE(register, 8);
      v.writeUInt16BE(aantal, 10);
      s.write(v);
    });
    let buf = Buffer.alloc(0);
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length < 9) return;
      clearTimeout(tijd);
      s.destroy();
      if (buf[7] & 0x80) return mis(new Error(`geweigerd (code ${buf[8]})`));
      klaar(buf.subarray(9, 9 + buf[8]));
    });
  });
}

const tekst = (b) => b.toString('latin1').replace(/\0/g, '').trim();

function poortOpen(adres) {
  return new Promise((klaar) => {
    const s = net.connect({ host: adres, port: POORT });
    const tijd = setTimeout(() => {
      s.destroy();
      klaar(false);
    }, 600);
    s.once('connect', () => {
      clearTimeout(tijd);
      s.destroy();
      klaar(true);
    });
    s.once('error', () => {
      clearTimeout(tijd);
      klaar(false);
    });
  });
}

async function leesAlfen(adres) {
  const naam = tekst(await vraag(adres, 200, 100, 17));
  let fabrikant = '';
  try {
    fabrikant = tekst(await vraag(adres, 200, 117, 5));
  } catch {
    // niet erg
  }
  console.log(`\nGevonden op ${adres}: ${[fabrikant, naam].filter(Boolean).join(' · ') || 'iets met Modbus'}`);
  try {
    const w = (await vraag(adres, 1, 344, 2)).readFloatBE(0);
    console.log(`  Laadt nu: ${Math.round(w)} W`);
  } catch (e) {
    console.log(`  Vermogen lezen lukte niet (${e.message}).`);
  }
  try {
    const stand = tekst(await vraag(adres, 1, 1201, 5));
    const uitleg = { A: 'geen auto aangesloten', B: 'auto aangesloten, laadt niet', C: 'laadt', D: 'laadt (met ventilatie)', E: 'geen stroom', F: 'storing' };
    console.log(`  Stand: ${stand}${uitleg[stand?.[0]] ? ` (${uitleg[stand[0]]})` : ''}`);
  } catch (e) {
    console.log(`  Stand lezen lukte niet (${e.message}).`);
  }
  console.log('  Het werkt: deze paal kan het programmaatje uitlezen.');
}

async function main() {
  const arg = process.argv[2];
  let adressen;
  if (arg && /^\d+\.\d+\.\d+\.\d+$/.test(arg)) adressen = [arg];
  else {
    let netten = arg && /^\d+\.\d+\.\d+$/.test(arg) ? [`${arg}.`] : [];
    if (!netten.length) {
      try {
        netten = netwerkenUit(os.networkInterfaces());
      } catch {
        netten = [];
      }
    }
    if (!netten.length) {
      console.log('Ik weet niet in welk netwerk ik moet zoeken. Geef het mee, bijvoorbeeld: node brug/alfen-zoek.mjs 192.168.1');
      return;
    }
    adressen = netten.flatMap((n) => Array.from({ length: 254 }, (_, i) => `${n}${i + 1}`));
    console.log(`Zoeken naar een laadpaal met Modbus (poort ${POORT}) in ${netten.map((n) => `${n}x`).join(', ')} … (half minuutje)`);
  }
  const open = [];
  for (let i = 0; i < adressen.length; i += 32) {
    const deel = adressen.slice(i, i + 32);
    const uit = await Promise.all(deel.map(poortOpen));
    deel.forEach((a, j) => uit[j] && open.push(a));
  }
  if (!open.length) {
    console.log('\nGeen apparaat met Modbus (poort 502) gevonden.');
    console.log('Waarschijnlijk staat Modbus op de Alfen uit. Vraag de installateur: "Wilt u op mijn Alfen-laadpaal Modbus TCP (voor energiebeheer) aanzetten?"');
    return;
  }
  for (const a of open) {
    try {
      await leesAlfen(a);
    } catch (e) {
      console.log(`\nOp ${a} staat poort 502 open, maar het is geen Alfen of hij weigert (${e.message}).`);
    }
  }
}

await main();
