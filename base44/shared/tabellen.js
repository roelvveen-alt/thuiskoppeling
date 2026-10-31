/**
 * De tabellen Huis, Meting, Opstelling, Dag en Gebeurtenis met de rol van de server, zoals de
 * functies ze gebruiken: elke aanroep met geduld bij de rem (geduld.js), `get`
 * geeft null in plaats van een fout als de rij er niet is, en een lijst is
 * altijd een lijst.
 *
 * Met de rol van de server gelden de rechtenregels van Base44 niet. Wie wat
 * mag, staat in toegang.js; lees daar eerst.
 */
import { metGeduld } from './geduld.js';

const statusVan = (e) => e?.status ?? e?.response?.status ?? null;

/** Geen rij met dit id (of een id dat Base44 niet kent). */
export const nietGevonden = (e) => statusVan(e) === 404 || statusVan(e) === 400;

function tabel(bron, geduld) {
  const metRem = (werk) => metGeduld(werk, geduld);
  return {
    async get(id) {
      try {
        return (await metRem(() => bron.get(id))) ?? null;
      } catch (e) {
        if (nietGevonden(e)) return null;
        throw e;
      }
    },
    list: async (sortering, aantal, vanaf) => (await metRem(() => bron.list(sortering, aantal, vanaf))) ?? [],
    filter: async (waar, sortering, aantal, vanaf) => (await metRem(() => bron.filter(waar, sortering, aantal, vanaf))) ?? [],
    create: (velden) => metRem(() => bron.create(velden)),
    update: (id, velden) => metRem(() => bron.update(id, velden)),
  };
}

/**
 * @param {object} entities  base44.asServiceRole.entities
 * @param {object} [geduld]  opties voor metGeduld (de tests wachten niet echt)
 */
export function tabellen(entities, geduld) {
  return {
    Huis: tabel(entities.Huis, geduld),
    Meting: tabel(entities.Meting, geduld),
    Opstelling: tabel(entities.Opstelling, geduld),
    Dag: tabel(entities.Dag, geduld),
    Gebeurtenis: tabel(entities.Gebeurtenis, geduld),
  };
}
