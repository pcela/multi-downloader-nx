#!/usr/bin/env python3
"""
Final Crunchyroll Credential Extractor
Takes APK file and extracts basic_auth_token and User-Agent
"""

import subprocess
import tempfile
import shutil
from pathlib import Path
import re

def extract_credentials(apk_path):
    """Extract credentials from APK using JADX"""
    
    # Check if JADX with JRE exists
    jadx_jre = Path("jadx-gui-1.5.5-with-jre-win")
    if not jadx_jre.exists():
        return None, "JADX with JRE not found"
    
    java_exe = jadx_jre / "jre" / "bin" / "java.exe"
    jadx_jar = Path("jadx-1.5.5") / "lib" / "jadx-1.5.5-all.jar"
    
    if not java_exe.exists() or not jadx_jar.exists():
        return None, "JADX components not found"
    
    # Create temp directory for decompilation
    with tempfile.TemporaryDirectory() as temp_dir:
        output_dir = Path(temp_dir) / "jadx_output"
        
        # Decompile APK
        print("Decompiling APK...")
        cmd = [
            str(java_exe),
            "-cp",
            str(jadx_jar),
            "jadx.cli.JadxCLI",
            "-d",
            str(output_dir),
            str(apk_path)
        ]
        
        print(f"Running: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=".")
        
        print(f"Return code: {result.returncode}")
        print(f"Stdout: {result.stdout}")
        print(f"Stderr: {result.stderr}")
        
        # Continue even if there are errors - output might still be usable
        if not output_dir.exists():
            return None, f"JADX output directory not created: {result.stderr}"
        
        # Search for constants file
        constants_file = output_dir / "sources" / "com" / "crunchyroll" / "api" / "util" / "Constants.java"
        
        if not constants_file.exists():
            return None, "Constants.java not found"
        
        # Extract credentials from Constants.java
        try:
            content = constants_file.read_text(encoding='utf-8', errors='ignore')
            
            # Find Android TV client ID and secret (not FireTV)
            # Look for the specific Android TV credentials
            client_id_match = re.search(r'PROD_CLIENT_ID\s*=\s*"([^"]+)"', content)
            client_secret_match = re.search(r'PROD_CLIENT_SECRET\s*=\s*"([^"]+)"', content)
            
            # Also look for FireTV to identify them
            firetv_id_match = re.search(r'FIRETV_PROD_CLIENT_ID\s*=\s*"([^"]+)"', content)
            firetv_secret_match = re.search(r'FIRETV_PROD_CLIENT_SECRET\s*=\s*"([^"]+)"', content)
            
            if not client_id_match or not client_secret_match:
                return None, "Client credentials not found in Constants.java"
            
            client_id = client_id_match.group(1)
            client_secret = client_secret_match.group(1)
            
            # If we got FireTV credentials, look for Android TV ones specifically
            if firetv_id_match and client_id == firetv_id_match.group(1):
                # This means we got the FireTV ID, need to find the Android TV one
                # Look for a different PROD_CLIENT_ID that's not the FireTV one
                all_prod_ids = re.findall(r'PROD_CLIENT_ID\s*=\s*"([^"]+)"', content)
                all_prod_secrets = re.findall(r'PROD_CLIENT_SECRET\s*=\s*"([^"]+)"', content)
                
                # Find the one that's not FireTV
                firetv_id = firetv_id_match.group(1)
                for i, prod_id in enumerate(all_prod_ids):
                    if prod_id != firetv_id:
                        client_id = prod_id
                        if i < len(all_prod_secrets):
                            client_secret = all_prod_secrets[i]
                        break
            
            # Create basic auth token
            basic_auth_string = f"{client_id}:{client_secret}"
            import base64
            basic_auth_token = base64.b64encode(basic_auth_string.encode()).decode()
            
            # Get version and version code from manifest
            manifest_file = output_dir / "resources" / "AndroidManifest.xml"
            version = "3.61.0"  # Default
            version_code = "22341"  # Default
            if manifest_file.exists():
                manifest_content = manifest_file.read_text(encoding='utf-8', errors='ignore')
                version_match = re.search(r'android:versionName="([^"]+)"', manifest_content)
                code_match = re.search(r'android:versionCode="([^"]+)"', manifest_content)
                if version_match:
                    version = version_match.group(1)
                if code_match:
                    version_code = code_match.group(1)
            
            # Create User-Agent in the correct format with version code
            user_agent = f"Crunchyroll/ANDROIDTV/{version}_{version_code} (Android 12; en-US; SHIELD Android TV Build/SR1A.211012.001)"
            
            return {
                'basic_auth_token': basic_auth_token,
                'user_agent': user_agent,
                'version': version,
                'client_id': client_id,
                'client_secret': client_secret
            }, "Success"
            
        except Exception as e:
            return None, f"Error parsing Constants.java: {e}"

def main():
    import sys
    
    if len(sys.argv) != 2:
        print("Usage: python extract_crunchy_creds_final.py <path_to_apk>")
        return 1
    
    apk_path = Path(sys.argv[1])
    
    if not apk_path.exists():
        print(f"APK file not found: {apk_path}")
        return 1
    
    print(f"Extracting credentials from: {apk_path}")
    
    credentials, message = extract_credentials(apk_path)
    
    if credentials:
        print("\n" + "="*60)
        print("🎉 CREDENTIALS EXTRACTED SUCCESSFULLY!")
        print("="*60)
        print()
        print("For module.api-urls.ts:")
        print(f"basic_auth_token: '{credentials['basic_auth_token']}'")
        print()
        print(f"crunchyDefUserAgent: '{credentials['user_agent']}'")
        print()
        print("Additional info:")
        print(f"Version: {credentials['version']}")
        print(f"Client ID: {credentials['client_id']}")
        print(f"Client Secret: {credentials['client_secret']}")
        print()
        
        # Save to file
        output_file = Path("extracted_credentials.txt")
        with open(output_file, 'w') as f:
            f.write(f"basic_auth_token: '{credentials['basic_auth_token']}'\n")
            f.write(f"crunchyDefUserAgent: '{credentials['user_agent']}'\n")
            f.write(f"# Version: {credentials['version']}\n")
            f.write(f"# Client ID: {credentials['client_id']}\n")
            f.write(f"# Client Secret: {credentials['client_secret']}\n")
        
        print(f"💾 Saved to: {output_file}")
        print("\n✅ Extraction completed successfully!")
        return 0
    else:
        print(f"\n❌ Extraction failed: {message}")
        return 1

if __name__ == "__main__":
    exit(main())
