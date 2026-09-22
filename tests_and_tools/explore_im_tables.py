import sys
import json
import os

try:
    import pymssql
    PYMSSQL_AVAILABLE = True
except ImportError:
    PYMSSQL_AVAILABLE = False

try:
    import pyodbc
    PYODBC_AVAILABLE = True
except ImportError:
    PYODBC_AVAILABLE = False

SQL_SERVER_HOST = '123.25.239.13'
SQL_SERVER_PORT = 669
SQL_SERVER_DB = 'PM2026BOPP'
SQL_SERVER_USER = 'Junsix_AppUser'
SQL_SERVER_PASS = 'BOPP!@#234521'

def connect_sql():
    if PYMSSQL_AVAILABLE:
        return pymssql.connect(
            server=SQL_SERVER_HOST,
            port=SQL_SERVER_PORT,
            user=SQL_SERVER_USER,
            password=SQL_SERVER_PASS,
            database=SQL_SERVER_DB,
            timeout=25,
            login_timeout=25,
            as_dict=True
        ), 'pymssql'
    elif PYODBC_AVAILABLE:
        conn_str = (
            'DRIVER={ODBC Driver 18 for SQL Server};'
            f'SERVER={SQL_SERVER_HOST},{SQL_SERVER_PORT};'
            f'DATABASE={SQL_SERVER_DB};'
            f'UID={SQL_SERVER_USER};'
            f'PWD={SQL_SERVER_PASS};'
            'TrustServerCertificate=yes;'
            'Encrypt=optional;'
        )
        return pyodbc.connect(conn_str, timeout=25), 'pyodbc'
    else:
        raise RuntimeError("No SQL Server library available.")

def main():
    conn, _ = connect_sql()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT TABLE_NAME 
        FROM INFORMATION_SCHEMA.TABLES 
        WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME LIKE 'IM_%'
        ORDER BY TABLE_NAME;
    """)
    tables = [r['TABLE_NAME'] for r in cursor.fetchall()]

    report = []
    report.append(f"# Báo Cáo Cấu Trúc Các Bảng Kho (IM_*) Trong Database PM2026BOPP\n")
    report.append(f"**Tổng số bảng tìm thấy:** {len(tables)} bảng\n")
    report.append("| STT | Tên Bảng | Số Dòng | Mục Đích / Ý Nghĩa Dự Kiến |")
    report.append("|---|---|---|---|")

    table_details = []

    for idx, t in enumerate(tables):
        try:
            cursor.execute(f"SELECT COUNT(*) AS cnt FROM [{t}]")
            cnt = cursor.fetchone()['cnt']
        except Exception as e:
            cnt = f"Lỗi: {e}"

        desc = ""
        t_upper = t.upper()
        if "ORDER" in t_upper or "REQ" in t_upper or "EO" in t_upper:
            desc = "Yêu cầu / Phiếu đặt hàng / Lệnh xuất kho"
        elif "ISSUE" in t_upper or "EXP" in t_upper:
            desc = "Phiếu xuất kho"
        elif "RCV" in t_upper or "IMP" in t_upper:
            desc = "Phiếu nhập kho"
        elif "STOCK" in t_upper:
            desc = "Số dư tồn kho / Kiểm kê kho"
        elif "SAFETY" in t_upper:
            desc = "Định mức tồn kho an toàn (Min/Max)"
        elif "WHOUSE" in t_upper:
            desc = "Danh mục kho"
        elif "ITEM" in t_upper:
            desc = "Danh mục vật tư hàng hóa"
        elif "AVG" in t_upper or "COST" in t_upper:
            desc = "Tính giá xuất kho bình quân"
        else:
            desc = "Bảng dữ liệu kho ERP"

        report.append(f"| {idx+1} | `{t}` | **{cnt:,}** | {desc} |" if isinstance(cnt, int) else f"| {idx+1} | `{t}` | {cnt} | {desc} |")

        # Columns
        cursor.execute(f"""
            SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = '{t}'
            ORDER BY ORDINAL_POSITION;
        """)
        cols = cursor.fetchall()

        # Samples
        samples = []
        if isinstance(cnt, int) and cnt > 0:
            try:
                cursor.execute(f"SELECT TOP 3 * FROM [{t}]")
                samples = cursor.fetchall()
            except Exception:
                pass

        table_details.append({
            "table_name": t,
            "row_count": cnt,
            "columns": cols,
            "samples": samples
        })

    report.append("\n---\n")
    report.append("## Chi Tiết Cấu Trúc Các Bảng Chính\n")

    for td in table_details:
        t = td["table_name"]
        cnt = td["row_count"]
        cols = td["columns"]
        samples = td["samples"]

        report.append(f"### Bảng: `{t}` ({cnt} dòng)")
        report.append("**Các cột:**")
        col_strs = [f"`{c['COLUMN_NAME']}` ({c['DATA_TYPE']}{f'({c[\"CHARACTER_MAXIMUM_LENGTH\"]})' if c['CHARACTER_MAXIMUM_LENGTH'] else ''})" for c in cols]
        report.append("- " + ", ".join(col_strs))

        if samples:
            report.append("\n**Dữ liệu mẫu:**")
            report.append("```json")
            for s in samples:
                clean_s = {k: v for k, v in s.items() if v is not None}
                report.append(json.dumps(clean_s, default=str, ensure_ascii=False))
            report.append("```")
        report.append("\n")

    with open("im_tables_report.md", "w", encoding="utf-8") as f:
        f.write("\n".join(report))

    with open("im_tables_details.json", "w", encoding="utf-8") as f:
        json.dump(table_details, f, default=str, ensure_ascii=False, indent=2)

    print(f"[+] Đã tạo xong báo cáo im_tables_report.md ({len(tables)} bảng)")
    conn.close()

if __name__ == '__main__':
    main()
