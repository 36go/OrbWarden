//! Windows DPAPI protection for locally stored auth tokens.
//!
//! Saved account tokens are kept in the frontend's localStorage. On Windows they
//! are wrapped with CryptProtectData scoped to the current user, so a raw token
//! never sits in plain text in app data. On non-Windows hosts the commands fail
//! cleanly and the frontend keeps tokens in plain text (this feature is
//! Windows-centric).

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

#[cfg(windows)]
use windows::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};

#[cfg_attr(windows, allow(dead_code))]
const ERR_UNSUPPORTED: &str = "token encryption is only supported on Windows";

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn LocalFree(hmem: isize) -> isize;
}

#[cfg(windows)]
fn to_blob(bytes: &[u8]) -> CRYPT_INTEGER_BLOB {
    CRYPT_INTEGER_BLOB {
        pbData: bytes.as_ptr() as *mut u8,
        cbData: bytes.len() as u32,
    }
}

#[cfg(windows)]
unsafe fn free_blob(blob: &CRYPT_INTEGER_BLOB) {
    if !blob.pbData.is_null() {
        LocalFree(blob.pbData as isize);
    }
}

/// Encrypts a plaintext value for the current Windows user. The result is
/// Base64-encoded so it round-trips through the frontend's JSON localStorage.
#[tauri::command]
pub fn dpapi_encrypt(input: String) -> Result<String, String> {
    #[cfg(windows)]
    {
        let mut out = CRYPT_INTEGER_BLOB::default();
        // SAFETY: `to_blob` keeps the input buffer alive for the duration of the
        // call. The returned blob is allocated by the API and freed below.
        let ok = unsafe {
            CryptProtectData(
                &to_blob(input.as_bytes()),
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out,
            )
        };
        if ok.is_err() {
            return Err("DPAPI encryption failed".to_string());
        }
        // SAFETY: `out` was just populated by CryptProtectData, so its
        // pbData/cbData describe the returned ciphertext buffer.
        let bytes = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize) };
        let encoded = BASE64.encode(bytes);
        // SAFETY: LocalFree(pbData) is the documented way to release the blob.
        unsafe { free_blob(&out) };
        Ok(encoded)
    }
    #[cfg(not(windows))]
    {
        let _ = input;
        Err(ERR_UNSUPPORTED.to_string())
    }
}

/// Reverses `dpapi_encrypt` for the same Windows user.
#[tauri::command]
pub fn dpapi_decrypt(input: String) -> Result<String, String> {
    #[cfg(windows)]
    {
        let decoded =
            BASE64.decode(input).map_err(|e| format!("invalid encrypted token: {}", e))?;
        let mut out = CRYPT_INTEGER_BLOB::default();
        // SAFETY: `to_blob` keeps the decoded buffer alive for the duration of
        // the call. The returned blob is allocated by the API and freed below.
        let ok = unsafe {
            CryptUnprotectData(
                &to_blob(&decoded),
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out,
            )
        };
        if ok.is_err() {
            return Err("DPAPI decryption failed".to_string());
        }
        // SAFETY: `out` was just populated by CryptUnprotectData, so its
        // pbData/cbData describe the returned plaintext buffer.
        let bytes = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize) };
        let plaintext = String::from_utf8(bytes.to_vec())
            .map_err(|_| "decrypted token is not UTF-8".to_string());
        // SAFETY: LocalFree(pbData) is the documented way to release the blob.
        unsafe { free_blob(&out) };
        plaintext
    }
    #[cfg(not(windows))]
    {
        let _ = input;
        Err(ERR_UNSUPPORTED.to_string())
    }
}