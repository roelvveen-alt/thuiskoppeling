/**
 * De verbinding met Base44, zonder de SDK in de site (prestaties-12).
 *
 * De site gebruikt van @base44/sdk alleen: de functie huis aanroepen, een foto
 * uploaden, iemand uitnodigen, en inloggen en uitloggen (doorsturen). De SDK
 * maakt bij het starten daarnaast ook realtime (socket.io), analytics, agents,
 * betalingen en axios aan: ~135 KB die de site nooit gebruikt. Dit bestand doet
 * precies wat de SDK (0.8.57, createClient met requiresAuth: false en analytics
 * uit) voor die vijf dingen doet, met fetch:
 *
 *   - Het token: bij het starten één keer uit de adresregel (?access_token=,
 *     na het inloggen; daarna weg uit de adresregel) of uit localStorage
 *     (base44_access_token), en bewaard onder base44_access_token en token.
 *     Zoals de SDK: dat token blijft tot de pagina opnieuw laadt. Vernieuwen
 *     doet de SDK niet; een verlopen token geeft 401 en dan stuurt de site
 *     naar het inloggen, dat met een nieuw token terugkomt.
 *   - functions.invoke: POST /api/apps/{app}/functions/{naam}, met dezelfde
 *     headers. Het antwoord zoals axios het gaf ({ data, status, headers });
 *     een fout met `response` ({ status, data, headers }) en `status`, en
 *     zonder antwoord (netwerk) zonder status. Zo ziet het loket
 *     (src/api/huis.js) precies hetzelfde: 401, 404, 429 met Retry-After.
 *   - integrations.Core.UploadPrivateFile en users.inviteUser: zoals de SDK
 *     ze uitpakt (alleen de data) en met dezelfde fout (status, message, data).
 *   - auth.redirectToLogin en auth.logout: dezelfde adressen op deze site.
 *
 * src/api/verbinding.test.js zet deze naast de echte SDK, tegen een
 * nepserver, en vergelijkt elke vraag en elk antwoord.
 */

const OPSLAG = 'base44_access_token';
// Zo noemde de ingebouwde SDK van Base44 (platform 2) hem; de SDK zet en wist ze allebei.
const OPSLAG_OUD = 'token';

function opslag(venster) {
  try {
    return venster?.localStorage ?? null;
  } catch {
    return null;
  }
}

function bewaarToken(venster, token) {
  try {
    opslag(venster)?.setItem(OPSLAG, token);
    opslag(venster)?.setItem(OPSLAG_OUD, token);
  } catch {
    // Vol of geblokkeerd: dan alleen voor deze pagina, zoals de SDK.
  }
}

/** Het token zoals de SDK het bij het starten vindt (getAccessToken): eerst de adresregel, dan localStorage. */
export function tokenBijStart(venster) {
  if (!venster) return null;
  try {
    const params = new URLSearchParams(venster.location.search);
    const uitAdres = params.get('access_token');
    if (uitAdres) {
      bewaarToken(venster, uitAdres);
      params.delete('access_token');
      const rest = params.toString();
      venster.history.replaceState({}, venster.document?.title ?? '', `${venster.location.pathname}${rest ? `?${rest}` : ''}${venster.location.hash}`);
      return uitAdres;
    }
  } catch {
    // Geen adresregel te lezen: dan localStorage.
  }
  try {
    return opslag(venster)?.getItem(OPSLAG) ?? null;
  } catch {
    return null;
  }
}

/** De body zoals axios hem teruggeeft: JSON als het JSON is, anders de tekst. */
async function bodyVan(res) {
  const tekst = await res.text();
  if (!tekst) return tekst;
  try {
    return JSON.parse(tekst);
  } catch {
    return tekst;
  }
}

/** Een fout zoals axios hem gaf (functies: de SDK pakt die niet uit). */
function httpFout(response) {
  return Object.assign(new Error(`Request failed with status code ${response.status}`), { status: response.status, response });
}

/** Een fout zoals de SDK hem maakt voor uitgepakte vragen (Base44Error). */
function base44Fout(e) {
  const data = e?.response?.data;
  const bericht = data?.error?.message || data?.message || data?.detail || e?.message;
  const fout = new Error(bericht);
  fout.name = 'Base44Error';
  fout.status = e?.response?.status;
  fout.code = data?.error?.code ?? data?.code ?? e?.response?.headers?.['x-base44-connector-error'];
  fout.data = data;
  return fout;
}

/**
 * @param {{ appId: string, serverUrl?: string, venster?: Window|null, haal?: typeof fetch }} opties
 */
export function maakVerbinding({ appId, serverUrl = 'https://base44.app', venster = typeof window === 'undefined' ? null : window, haal = (...a) => globalThis.fetch(...a) }) {
  let token = tokenBijStart(venster);
  if (token) bewaarToken(venster, token);
  const api = `${serverUrl}/api`;

  async function post(pad, body) {
    const headers = { Accept: 'application/json', 'X-App-Id': String(appId) };
    const formulier = typeof FormData !== 'undefined' && body instanceof FormData;
    // Bij een formulier zet de browser zelf het Content-Type, met de grens erin (axios doet dat ook).
    if (!formulier) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      if (venster?.location?.href) headers['X-Origin-URL'] = venster.location.href;
    } catch {
      // Geen adres: dan zonder, zoals de SDK buiten de browser.
    }
    const res = await haal(`${api}${pad}`, { method: 'POST', headers, body: formulier ? body : JSON.stringify(body) });
    const response = { status: res.status, data: await bodyVan(res), headers: Object.fromEntries(res.headers.entries()) };
    if (res.status < 200 || res.status >= 300) throw httpFout(response);
    return response;
  }

  /** Zoals de SDK zijn gewone vragen doet: alleen de data terug, een fout als Base44Error. */
  async function uitgepakt(pad, body) {
    try {
      return (await post(pad, body)).data;
    } catch (e) {
      throw base44Fout(e);
    }
  }

  return {
    functions: {
      async invoke(naam, data) {
        if (typeof data === 'string') throw new Error(`Function ${naam} must receive an object with named parameters, received: ${data}`);
        return post(`/apps/${appId}/functions/${naam}`, data);
      },
    },
    integrations: {
      Core: {
        async UploadPrivateFile(data) {
          const formulier = new FormData();
          for (const [sleutel, waarde] of Object.entries(data ?? {})) {
            if (typeof File !== 'undefined' && waarde instanceof File) formulier.append(sleutel, waarde, waarde.name);
            else if (typeof waarde === 'object' && waarde !== null) formulier.append(sleutel, JSON.stringify(waarde));
            else formulier.append(sleutel, waarde);
          }
          return uitgepakt(`/apps/${appId}/integration-endpoints/Core/UploadPrivateFile`, formulier);
        },
      },
    },
    users: {
      async inviteUser(email, rol) {
        if (rol !== 'user' && rol !== 'admin') throw new Error(`Invalid role: "${rol}". Role must be either "user" or "admin".`);
        return uitgepakt(`/apps/${appId}/runtime/users/invite-user`, { user_email: email, role: rol });
      },
    },
    auth: {
      /** Of er een token is (anders kan elke vraag alleen 401 worden). */
      heeftToken: () => Boolean(token),
      redirectToLogin(volgende) {
        const terug = volgende ? new URL(volgende, venster.location.origin).toString() : venster.location.href;
        venster.location.href = `/login?from_url=${encodeURIComponent(terug)}`;
      },
      logout(terug) {
        token = null;
        try {
          opslag(venster)?.removeItem(OPSLAG);
          opslag(venster)?.removeItem(OPSLAG_OUD);
        } catch {
          // Geblokkeerd: de server-kant (hieronder) logt toch uit.
        }
        venster.location.href = `/api/apps/auth/logout?from_url=${encodeURIComponent(terug || venster.location.href)}`;
      },
    },
  };
}
