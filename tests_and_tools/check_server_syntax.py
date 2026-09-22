import py_compile
import sys

try:
    py_compile.compile('server.py', doraise=True)
    print("[+] server.py syntax is VALID!")
except Exception as e:
    print(f"[-] Syntax error: {e}")
    sys.exit(1)
