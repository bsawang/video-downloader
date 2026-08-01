"""打包插件为安装文件。

生成（到 dist/）：
  video-downloader-v{version}.zip   # 解压后开发者模式"加载已解压"；或新版 Chrome 直接拖入
  video-downloader-v{version}.crx   # Chrome 打包扩展（拖入 chrome://extensions 安装）

crx v3 格式：Cr24 + version + header(pubkey + RSA-SHA256 签名) + zip payload。
pem 私钥首次生成存 dist/build/key.pem（复用同一密钥保证更新可装），不提交 git。

用法：
  .venv/Scripts/python build.py            # 打包当前 extension/
"""
import pathlib
import struct
import subprocess
import sys
import tempfile
import zipfile

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parent
EXT = ROOT / "extension"
DIST = ROOT / "dist"
KEY = DIST / "build" / "key.pem"
OPENSSL = "openssl"


def version():
    import json
    return json.loads((EXT / "manifest.json").read_text(encoding="utf-8"))["version"]


def make_zip() -> bytes:
    """打包 extension/ 目录内容为 zip bytes（manifest.json 在 zip 根）。"""
    buf = __import__("io").BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(EXT.rglob("*")):
            if f.is_file() and f.name not in (".gitkeep",):
                z.write(f, f.relative_to(EXT).as_posix())
    return buf.getvalue()


def ensure_key():
    if not KEY.exists():
        KEY.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run([OPENSSL, "genrsa", "-out", str(KEY), "2048"], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print("已生成签名密钥:", KEY)


def make_crx(zip_bytes: bytes) -> bytes:
    """用 openssl 对 zip 做 RSA-SHA256 签名，拼出 crx v3。"""
    ensure_key()
    with tempfile.TemporaryDirectory() as td:
        td = pathlib.Path(td)
        zipf, sigf, pubf = td / "ext.zip", td / "sig.bin", td / "pub.bin"
        zipf.write_bytes(zip_bytes)
        # 签名（RSASSA-PKCS1-v1_5 + SHA256）
        subprocess.run([OPENSSL, "dgst", "-sha256", "-sign", str(KEY), "-out", str(sigf), str(zipf)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        # 公钥 DER
        subprocess.run([OPENSSL, "rsa", "-in", str(KEY), "-pubout", "-outform", "DER",
                        "-out", str(pubf)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        pub, sig = pubf.read_bytes(), sigf.read_bytes()
    header = struct.pack("<II", len(pub), len(sig)) + pub + sig
    return b"Cr24" + struct.pack("<II", 3, len(header)) + header + zip_bytes


def main():
    ver = version()
    zip_bytes = make_zip()
    DIST.mkdir(parents=True, exist_ok=True)

    zip_path = DIST / f"video-downloader-v{ver}.zip"
    zip_path.write_bytes(zip_bytes)
    print(f"✅ {zip_path}  ({len(zip_bytes)/1024:.0f} KB)")

    crx_path = DIST / f"video-downloader-v{ver}.crx"
    crx_bytes = make_crx(zip_bytes)
    crx_path.write_bytes(crx_bytes)
    print(f"✅ {crx_path}  ({len(crx_bytes)/1024:.0f} KB)")

    print("\n安装方式：")
    print(f"  · .crx: chrome://extensions → 开启开发者模式 → 拖入 {crx_path.name}")
    print(f"  · .zip: 解压后 chrome://extensions → 加载已解压 → 选解压目录")


if __name__ == "__main__":
    sys.exit(main())
