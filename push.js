// Web Push (VAPID + RFC 8291 aes128gcm) implemented with Node's built-in crypto — zero dependencies.
const crypto = require('crypto');
const { data, save } = require('./store');

const b64u = (buf) => Buffer.from(buf).toString('base64url');

// ---- VAPID keys (generated once, stored in settings) ----
function ensureVapid() {
  if (data.settings.vapid) return data.settings.vapid;
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  data.settings.vapid = {
    publicJwk: publicKey.export({ format: 'jwk' }),
    privateJwk: privateKey.export({ format: 'jwk' }),
  };
  save();
  return data.settings.vapid;
}
function rawPublicKey(jwk) { // 65-byte uncompressed EC point, base64url — what the browser needs
  return b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]));
}
function getPublicKey() { return rawPublicKey(ensureVapid().publicJwk); }

function vapidAuthHeader(endpoint) {
  const { publicJwk, privateJwk } = ensureVapid();
  const aud = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:ops@kingofpops.com' }));
  const signing = `${header}.${payload}`;
  const key = crypto.createPrivateKey({ key: privateJwk, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(signing), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${signing}.${b64u(sig)}, k=${rawPublicKey(publicJwk)}`;
}

// ---- RFC 8291 payload encryption (aes128gcm) ----
function encryptPayload(subscription, plaintext) {
  const uaPublicRaw = Buffer.from(subscription.keys.p256dh, 'base64url'); // 65 bytes
  const authSecret = Buffer.from(subscription.keys.auth, 'base64url');    // 16 bytes

  const uaPublic = crypto.createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: b64u(uaPublicRaw.subarray(1, 33)), y: b64u(uaPublicRaw.subarray(33, 65)) },
    format: 'jwk',
  });
  const asKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const asPublicJwk = asKeys.publicKey.export({ format: 'jwk' });
  const asPublicRaw = Buffer.concat([Buffer.from([4]), Buffer.from(asPublicJwk.x, 'base64url'), Buffer.from(asPublicJwk.y, 'base64url')]);

  const ecdhSecret = crypto.diffieHellman({ privateKey: asKeys.privateKey, publicKey: uaPublic });

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublicRaw, asPublicRaw]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', ecdhSecret, authSecret, keyInfo, 32));

  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));

  // aes128gcm content-coding header: salt(16) | rs(4) | idlen(1) | keyid(65)
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  const header = Buffer.concat([salt, rs, Buffer.from([asPublicRaw.length]), asPublicRaw]);

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const padded = Buffer.concat([Buffer.from(plaintext), Buffer.from([2])]); // 0x02 = last record delimiter
  const body = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);
  return Buffer.concat([header, body]);
}

// ---- send ----
async function sendPush(subscription, payloadObj) {
  const body = encryptPayload(subscription, JSON.stringify(payloadObj));
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(body.length),
      TTL: '3600',
      Urgency: 'high',
      Authorization: vapidAuthHeader(subscription.endpoint),
    },
    body,
  });
  return res.status; // 201 = accepted; 404/410 = subscription gone
}

// send to all of a user's devices; prune dead subscriptions
async function pushToUser(userId, payloadObj) {
  const subs = data.push_subs.filter(s => s.user_id === userId);
  for (const s of subs) {
    try {
      const status = await sendPush(s.sub, payloadObj);
      if (status === 404 || status === 410) {
        data.push_subs = data.push_subs.filter(x => x.id !== s.id);
        save();
      }
    } catch (e) { console.error('push failed:', e.message); }
  }
}

module.exports = { getPublicKey, sendPush, pushToUser, encryptPayload };
