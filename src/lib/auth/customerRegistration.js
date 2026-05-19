export function validateRegistrationPayload(body = {}) {
  const { email, password, confirmPassword, displayName, phone, telegramChatId, referralCode } = body || {};
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const passwordValue = String(password || "");

  if (!normalizedEmail || !passwordValue) {
    return { ok: false, error: "email and password are required", status: 400 };
  }
  if (passwordValue.length < 8) {
    return { ok: false, error: "password must be at least 8 characters", status: 400 };
  }
  if (confirmPassword !== undefined && passwordValue !== String(confirmPassword || "")) {
    return { ok: false, error: "password confirmation does not match", status: 400 };
  }

  // Referral code is optional. Accept 4-16 chars [A-Z0-9]; we uppercase server-side.
  let normalizedReferral = null;
  if (referralCode !== undefined && referralCode !== null && String(referralCode).trim() !== "") {
    const r = String(referralCode).trim().toUpperCase();
    if (!/^[A-Z0-9]{4,16}$/.test(r)) {
      return { ok: false, error: "referralCode invalid", status: 400 };
    }
    normalizedReferral = r;
  }

  return {
    ok: true,
    value: {
      email: normalizedEmail,
      password: passwordValue,
      displayName,
      phone,
      telegramChatId,
      referralCode: normalizedReferral,
    },
  };
}
