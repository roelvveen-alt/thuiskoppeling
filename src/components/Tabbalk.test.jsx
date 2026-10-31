import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Tabbalk from './Tabbalk';

describe('tabbalk', () => {
  it('een vraag van het programmaatje: een stipje bij Apparaten, en voor een schermlezer in woorden', () => {
    const html = renderToStaticMarkup(<Tabbalk gekozen="huis" onKies={() => {}} vragen={2} />);
    expect(html.match(/tab-stip/g)).toHaveLength(1);
    expect(html).toContain(', 2 vragen voor jou');
    const apparaten = html.slice(html.indexOf('id="tab-apparaten"'));
    expect(apparaten).toContain('tab-stip');
  });

  it('geen vragen (of een kijker): geen stipje', () => {
    expect(renderToStaticMarkup(<Tabbalk gekozen="huis" onKies={() => {}} />)).not.toContain('tab-stip');
    expect(renderToStaticMarkup(<Tabbalk gekozen="huis" onKies={() => {}} vragen={0} />)).not.toContain('voor jou');
  });
});
