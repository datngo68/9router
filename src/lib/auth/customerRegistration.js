export function validateRegistrationPayload(body = {}) {
  const { email, password, confirmPassword, displayName, phone, telegramChatId } = body || {};
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

  return {
    ok: true,
    value: {
      email: normalizedEmail,
      password: passwordValue,
      displayName,
      phone,
      telegramChatId,
    },
  };
}
