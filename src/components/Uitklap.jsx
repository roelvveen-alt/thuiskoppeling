import { ChevronDown } from 'lucide-react';

/**
 * Een blok dat dicht staat tot je erop tikt (details/summary), met een eigen
 * pijltje: het driehoekje van de browser valt weg in een flex-summary of ziet
 * er overal anders uit. De regel om op te tikken is minstens 44 px hoog.
 */
export default function Uitklap({ titel, open = false, children, className = '', tekst = 'text-[14px]' }) {
  return (
    <details className={`group ${tekst} ${className}`} open={open}>
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-tekst-zacht hover:text-tekst [&::-webkit-details-marker]:hidden">
        <ChevronDown size={18} className="flex-none transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
        {titel}
      </summary>
      {children}
    </details>
  );
}
