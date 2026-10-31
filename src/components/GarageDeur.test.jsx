// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import HuisTekening from './HuisTekening';

afterEach(cleanup);

it('de garagedeur bij de tekening garage rolt open als je erop tikt en weer dicht bij de volgende tik', () => {
  const { container } = render(<HuisTekening soort="garage" dag />);
  const deur = () => container.querySelector('[data-garagedeur]').getAttribute('data-garagedeur');
  const knop = () => container.querySelector('[data-garageknop]');
  expect(deur()).toBe('dicht');
  fireEvent.click(knop());
  expect(deur()).toBe('open');
  expect(container.querySelector('.garagedeur-blad').style.transform).toContain('translateY');
  fireEvent.click(knop());
  expect(deur()).toBe('dicht');
});
