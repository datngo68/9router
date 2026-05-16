// Email notifications. Real SMTP implementation arrives in the notify task;
// this stub lets the auth/order routes import the module without failing
// at boot when SMTP is not yet configured.
//
// All functions silently no-op (with a console log) when the module isn't
// configured. Configured = settings.smtpHost present.

import { getSettings } from "@/lib/localDb";

let nodemailerPromise = null;
async function getNodemailer() {
  if (!nodemailerPromise) {
    nodemailerPromise = import("nodemailer").catch(() => null);
  }
  return nodemailerPromise;
}

async function readSmtpSettings() {
  try {
    const settings = await getSettings();
    return {
      host: settings.smtpHost,
      port: Number(settings.smtpPort) || 587,
      secure: !!settings.smtpSecure,
      user: settings.smtpUser,
      pass: settings.smtpPass,
      from: settings.smtpFrom || settings.smtpUser,
      storeName: settings.storeName || "9Router",
      storeUrl: settings.storeUrl || "",
    };
  } catch {
    return null;
  }
}

async function sendMail({ to, subject, text, html }) {
  const cfg = await readSmtpSettings();
  if (!cfg?.host || !cfg?.user || !cfg?.pass) {
    console.log("[email] SMTP not configured; skipping send", { subject, to });
    return { skipped: true };
  }
  const nm = await getNodemailer();
  if (!nm) {
    console.log("[email] nodemailer not installed; skipping send");
    return { skipped: true };
  }
  const transporter = nm.default.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  });
  try {
    await transporter.sendMail({ from: cfg.from, to, subject, text, html });
    return { ok: true };
  } catch (e) {
    console.log("[email] sendMail failed:", e.message);
    return { ok: false, error: e.message };
  }
}

export async function sendPasswordResetEmail({ email, displayName, token }) {
  const cfg = await readSmtpSettings();
  const url = cfg?.storeUrl ? `${cfg.storeUrl.replace(/\/$/, "")}/store/reset/${encodeURIComponent(token)}` : `/store/reset/${encodeURIComponent(token)}`;
  const subject = `${cfg?.storeName || "9Router"} — Đặt lại mật khẩu`;
  const text = `Xin chào ${displayName || email},\n\nNhấp vào liên kết sau để đặt lại mật khẩu (hết hạn sau 1 giờ):\n${url}\n\nNếu bạn không yêu cầu, bỏ qua email này.`;
  const html = `<p>Xin chào ${displayName || email},</p><p>Nhấp vào liên kết sau để đặt lại mật khẩu (hết hạn sau 1 giờ):</p><p><a href="${url}">${url}</a></p><p>Nếu bạn không yêu cầu, bỏ qua email này.</p>`;
  return sendMail({ to: email, subject, text, html });
}

export async function sendKeyDeliveredEmail({ email, displayName, planName, key, keyDisplay, portalUrl }) {
  const cfg = await readSmtpSettings();
  const subject = `${cfg?.storeName || "9Router"} — API key của bạn đã sẵn sàng`;
  const text = `Xin chào ${displayName || email},\n\nĐơn gói "${planName}" đã được giao. API key của bạn:\n\n${key}\n\nLưu ý: đây là lần duy nhất hiển thị key đầy đủ. Hãy lưu lại an toàn. Khi cần, bạn có thể tham khảo bản rút gọn (${keyDisplay}) trong trang quản lý.\n\nQuản lý key & usage: ${portalUrl || cfg?.storeUrl + "/store/account" || "/store/account"}`;
  const html = `<p>Xin chào ${displayName || email},</p>
    <p>Đơn gói <strong>${planName}</strong> đã được giao. API key của bạn:</p>
    <pre style="padding:12px;background:#f5f5f5;border-radius:6px">${key}</pre>
    <p><em>Đây là lần duy nhất hiển thị key đầy đủ — hãy lưu lại an toàn.</em></p>
    <p>Quản lý key & usage: <a href="${portalUrl || (cfg?.storeUrl || "") + "/store/account"}">portal</a></p>`;
  return sendMail({ to: email, subject, text, html });
}

export async function sendOrderCreatedEmail({ email, displayName, order, planName, paymentInfo }) {
  const cfg = await readSmtpSettings();
  const subject = `${cfg?.storeName || "9Router"} — Đơn ${order.id} đã tạo`;
  const text = `Xin chào ${displayName || email},\n\nĐơn ${order.id} (${planName}) đã được tạo, đang chờ thanh toán.\n\nNội dung chuyển khoản: ${order.id}\nSố tiền: ${order.priceVnd.toLocaleString("vi-VN")}đ\n\n${paymentInfo || ""}\n\nSau khi chúng tôi xác nhận thanh toán, key sẽ được gửi qua email.`;
  const html = `<p>Xin chào ${displayName || email},</p>
    <p>Đơn <strong>${order.id}</strong> (${planName}) đã được tạo.</p>
    <p>Nội dung chuyển khoản: <code>${order.id}</code><br/>Số tiền: <strong>${order.priceVnd.toLocaleString("vi-VN")}đ</strong></p>
    <pre>${paymentInfo || ""}</pre>
    <p>Sau khi xác nhận thanh toán, key sẽ được gửi qua email.</p>`;
  return sendMail({ to: email, subject, text, html });
}

export async function sendKeyRegeneratedEmail({ email, displayName, key, keyDisplay }) {
  const cfg = await readSmtpSettings();
  const subject = `${cfg?.storeName || "9Router"} — API key đã được làm mới`;
  const text = `API key của bạn vừa được làm mới (${keyDisplay}):\n\n${key}\n\nĐây là lần duy nhất hiển thị key đầy đủ. Key cũ đã bị thu hồi.`;
  const html = `<p>API key vừa được làm mới (${keyDisplay}):</p><pre>${key}</pre><p>Đây là lần duy nhất hiển thị key đầy đủ. Key cũ đã bị thu hồi.</p>`;
  return sendMail({ to: email, subject, text, html });
}
