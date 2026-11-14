/**
 * Ed25519 signing for world edits, via WebCrypto (globalThis.crypto.subtle),
 * which browsers and Node both provide, so this stays isomorphic.
 */
import { opPayload, type Op, type UnsignedOp } from './edits.ts';

const ALG = { name: 'Ed25519' } as const;
const enc = new TextEncoder();
/** UTF-8 bytes in an ArrayBuffer-backed array, as WebCrypto's types require. */
const utf8 = (s: string): Uint8Array<ArrayBuffer> => new Uint8Array(enc.encode(s));

export function toB64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(b.length));
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

export interface Identity {
  /** Public key, base64url: the author id on every op. */
  pub: string;
  privateKey: CryptoKey;
}

export async function generateIdentityKeys(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey(ALG, false, ['sign', 'verify'])) as CryptoKeyPair;
}

export async function identityFromKeys(keys: CryptoKeyPair): Promise<Identity> {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
  return { pub: toB64url(raw), privateKey: keys.privateKey };
}

/** Sign an op as this identity. `at` is the author's clock in unix seconds: take it from the store's clock (OpStore.now). */
export async function signOp(world: string, id: Identity, op: Omit<UnsignedOp, 'author'>): Promise<Op> {
  const unsigned: UnsignedOp = { ...op, author: id.pub };
  const sig = new Uint8Array(await crypto.subtle.sign(ALG, id.privateKey, utf8(opPayload(world, unsigned))));
  return { ...unsigned, sig: toB64url(sig) };
}

const verifyKeys = new Map<string, Promise<CryptoKey | null>>();

function verifyKey(author: string): Promise<CryptoKey | null> {
  let k = verifyKeys.get(author);
  if (!k) {
    k = (async () => {
      try {
        const raw = fromB64url(author);
        if (raw.length !== 32) return null;
        return await crypto.subtle.importKey('raw', raw, ALG, true, ['verify']);
      } catch {
        return null;
      }
    })();
    if (verifyKeys.size > 10_000) verifyKeys.clear();
    verifyKeys.set(author, k);
  }
  return k;
}

/** True if the op's signature is valid for its author in this world. */
export async function verifyOp(world: string, op: Op): Promise<boolean> {
  const key = await verifyKey(op.author);
  if (!key) return false;
  try {
    const { sig, ...unsigned } = op;
    return await crypto.subtle.verify(ALG, key, fromB64url(sig), utf8(opPayload(world, unsigned)));
  } catch {
    return false;
  }
}
