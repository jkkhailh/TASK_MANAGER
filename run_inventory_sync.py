from sync_service import sync_erp_inventory

if __name__ == '__main__':
    result = sync_erp_inventory()
    print("\n=== KẾT QUẢ ĐỒNG BỘ TỒN KHO ERP VỀ SQLITE ===")
    for k, v in result.items():
        print(f"  {k}: {v}")
