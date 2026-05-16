// Common Vietnamese banks for the storefront. Source: NAPAS/VietQR.
// Code is the BIN-based short name VietQR accepts.
//
// We keep this list small (top 12) — admin can also paste a custom code that
// VietQR recognizes via the free-form input.

export const VN_BANKS = [
  { code: "VCB", bin: "970436", name: "Vietcombank", fullName: "Ngân hàng TMCP Ngoại Thương Việt Nam" },
  { code: "TCB", bin: "970407", name: "Techcombank", fullName: "Ngân hàng TMCP Kỹ Thương Việt Nam" },
  { code: "MB", bin: "970422", name: "MB Bank", fullName: "Ngân hàng TMCP Quân Đội" },
  { code: "VIB", bin: "970441", name: "VIB", fullName: "Ngân hàng TMCP Quốc Tế" },
  { code: "ACB", bin: "970416", name: "ACB", fullName: "Ngân hàng TMCP Á Châu" },
  { code: "TPB", bin: "970423", name: "TPBank", fullName: "Ngân hàng TMCP Tiên Phong" },
  { code: "VPB", bin: "970432", name: "VPBank", fullName: "Ngân hàng TMCP Việt Nam Thịnh Vượng" },
  { code: "STB", bin: "970403", name: "Sacombank", fullName: "Ngân hàng TMCP Sài Gòn Thương Tín" },
  { code: "BIDV", bin: "970418", name: "BIDV", fullName: "Ngân hàng TMCP Đầu tư và Phát triển Việt Nam" },
  { code: "ICB", bin: "970415", name: "Vietinbank", fullName: "Ngân hàng TMCP Công Thương Việt Nam" },
  { code: "AGR", bin: "970405", name: "Agribank", fullName: "Ngân hàng Nông nghiệp và Phát triển Nông thôn" },
  { code: "OCB", bin: "970448", name: "OCB", fullName: "Ngân hàng TMCP Phương Đông" },
  { code: "MSB", bin: "970426", name: "MSB", fullName: "Ngân hàng TMCP Hàng Hải" },
  { code: "HDB", bin: "970437", name: "HDBank", fullName: "Ngân hàng TMCP Phát triển TPHCM" },
  { code: "SHB", bin: "970443", name: "SHB", fullName: "Ngân hàng TMCP Sài Gòn - Hà Nội" },
  { code: "EIB", bin: "970431", name: "Eximbank", fullName: "Ngân hàng TMCP Xuất Nhập Khẩu" },
];

/**
 * Build a VietQR image URL for a given order. Returns null if the admin
 * hasn't fully configured a bank account.
 *
 * https://img.vietqr.io/image/{BANK}-{ACCOUNT_NO}-{TEMPLATE}.png?amount=...&addInfo=...&accountName=...
 */
export function buildVietQrUrl({ bank, accountNo, accountName, amount, addInfo, template = "compact2" }) {
  if (!bank || !accountNo) return null;
  const params = new URLSearchParams();
  if (amount) params.set("amount", String(amount));
  if (addInfo) params.set("addInfo", addInfo);
  if (accountName) params.set("accountName", accountName);
  const qs = params.toString();
  return `https://img.vietqr.io/image/${encodeURIComponent(bank)}-${encodeURIComponent(accountNo)}-${template}.png${qs ? `?${qs}` : ""}`;
}
