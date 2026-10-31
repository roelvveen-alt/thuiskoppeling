import { useId, useState } from 'react';

/**
 * Eén naam invullen en bewaren: een omgeving maken of hernoemen. De knop staat
 * naast het veld, en op een smalle telefoon eronder.
 */
export default function NaamFormulier({ label, knop, Icoon, begin = '', onBewaar, onAnnuleer, plaatshouder }) {
  const id = useId();
  const [naam, setNaam] = useState(begin);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState(null);

  const bewaar = async (e) => {
    e.preventDefault();
    if (bezig) return;
    setBezig(true);
    setFout(null);
    try {
      await onBewaar(naam.trim());
    } catch (f) {
      setFout(f?.message || 'Dat lukte niet. Probeer het nog eens.');
    } finally {
      setBezig(false);
    }
  };

  return (
    <form className="grid gap-2" onSubmit={bewaar}>
      <label htmlFor={id} className="text-[14px] font-semibold">
        {label}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={id}
          className="veld flex-[1_1_180px]"
          value={naam}
          maxLength={40}
          required
          placeholder={plaatshouder}
          onChange={(e) => setNaam(e.target.value)}
        />
        <button type="submit" className="knop knop-hoofd" disabled={bezig || !naam.trim()}>
          {Icoon && <Icoon size={18} aria-hidden="true" />} {bezig ? 'Even geduld…' : knop}
        </button>
        {onAnnuleer && (
          <button type="button" className="knop" onClick={onAnnuleer} disabled={bezig}>
            Annuleren
          </button>
        )}
      </div>
      {fout && (
        <p className="m-0 text-[14px] text-fout" role="alert">
          {fout}
        </p>
      )}
    </form>
  );
}
