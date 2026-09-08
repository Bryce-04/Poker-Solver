"""Dump the Pydantic models as JSON Schema, which `pnpm generate` (see
package.json) then feeds through json-schema-to-typescript to produce
generated/spot.ts. Run this after any change to models.py.

    python scripts/export_json_schema.py
"""

import json
from pathlib import Path

from poker_solver_schema.models import HandRange, Spot, User

OUT_DIR = Path(__file__).parent.parent / "generated"


def main() -> None:
    OUT_DIR.mkdir(exist_ok=True)
    for model in (Spot, User, HandRange):
        schema = model.model_json_schema()
        out_path = OUT_DIR / f"{model.__name__}.schema.json"
        out_path.write_text(json.dumps(schema, indent=2))
        print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
