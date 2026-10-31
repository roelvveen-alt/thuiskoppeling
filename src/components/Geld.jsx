import { Euro } from 'lucide-react';
import { euro, geldRegels, prijsPerKwh } from '@/lib/opmaak';
import Tegel from './Tegel';

/**
 * Betaald, verdiend, vast en netto: wat de meterkast kostte of opleverde,
 * vandaag of over een week, maand, kwartaal of jaar. Eronder de gemiddelde
 * prijs per kWh, als er genoeg afgenomen of teruggeleverd is.
 */
export default function Geld({ kop, kosten, opbrengst, vast = null, compleet = true, zonderVast = 0, afnamePrijs = null, terugPrijs = null, wanneer = 'vandaag' }) {
  const regels = geldRegels({ kosten, opbrengst, vast });
  const prijzen = [
    afnamePrijs === null ? null : { tekst: 'afgenomen', prijs: afnamePrijs },
    terugPrijs === null ? null : { tekst: 'teruggeleverd', prijs: terugPrijs },
  ].filter(Boolean);
  return (
    <Tegel soort="geld" icoon={Euro} kop={kop} breed>
      <dl className="m-0 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {regels.map(([label, bedrag]) => (
          <div key={label} className="grid min-w-0 gap-0.5">
            <dt className="truncate text-[12.5px] text-tekst-zacht">{label}</dt>
            <dd className="cijfer m-0 text-[17px] font-bold">{euro(bedrag)}</dd>
          </div>
        ))}
      </dl>
      {prijzen.length > 0 && (
        <span className="text-[13px] leading-snug text-tekst-zacht">
          Gemiddeld{' '}
          {prijzen.map((p, i) => (
            <span key={p.tekst}>
              {i > 0 ? ' en ' : ''}
              <span className="cijfer text-tekst">{prijsPerKwh(p.prijs)}</span> per kWh {p.tekst}
            </span>
          ))}
          .
        </span>
      )}
      {!compleet && <span className="text-[12.5px] text-tekst-zacht">Een deel van {wanneer} had nog geen prijs; dat zit niet in deze bedragen.</span>}
      {vast !== null && zonderVast > 0 && (
        <span className="text-[12.5px] text-tekst-zacht">
          {zonderVast === 1 ? 'Eén dag had' : `${zonderVast} dagen hadden`} geen vaste kosten; die tellen in netto niet mee.
        </span>
      )}
    </Tegel>
  );
}
