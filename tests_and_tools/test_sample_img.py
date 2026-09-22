import os
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from nas_storage import get_file_for_serving

test_path = "recurring_samples/items/94/sample_item_94_20260919_144818_6f10824b.jpg"
p = get_file_for_serving(test_path)
print("Served path:", p, "Exists:", os.path.exists(p) if p else False)
