# Retail data file — schema 1.0

A founder loads one JSON document on **Brand**. The trend step reads that document and no other retailer's file. The two classroom extracts are stored in the repository:

| Retailer | Local file | Download |
| --- | --- | --- |
| Coles | `src/data/retail/coles.json` | `GET /api/retail-data/coles` |
| Woolworths | `src/data/retail/woolworths.json` | `GET /api/retail-data/woolworths` |

A real retailer uses the same document. There is no separate write API. Upload the file on Brand, or replace the local JSON and load it with the matching button.

The classroom files are synthetic. They are shaped like a weekly sales extract, a catalogue snapshot and a competitor price check. They are not a live Coles or Woolworths feed.

## File object

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `schemaVersion` | `"1.0"` | yes | Rejects any other version. |
| `retailer.id` | string | yes | Stable id, such as `coles`. Used only as a label. |
| `retailer.name` | string | yes | Must match the brand name. `Woolworth` and `Woolworths` match each other. `Coles` matches a name that starts with Coles. |
| `retailer.country` | `AU` \| `NZ` \| `UK` \| `US` | yes | Must match the campaign country. |
| `currency` | `"AUD"` | yes | Prices in the file are AUD. |
| `extractedAt` | `YYYY-MM-DD` | yes | The day this extract was cut. |
| `note` | string | no | Shown on Brand. Say when the file is synthetic. |
| `products` | array | yes | At least one article, at most 200. |

## Product

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `sku` | string | yes | The retailer's own article number. |
| `name` | string | yes | Name a campaign product can match, such as `Vegemite 220g`. |
| `brandName` | string | yes | The product brand, not the retailer. |
| `category` | string | yes | Used when the campaign names a category and not a product. |
| `subcategory` | string | yes | Shelf family, such as `Spreads`. |
| `aliases` | string[] | no | Extra names that should hit this article, such as `mandarins`. |
| `pos` | object | yes | Sales window. |
| `catalogue` | object | yes | Current range and price. |
| `competitors` | array | yes | At least one other banner. At most six. |

### `pos`

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `periodFrom` | `YYYY-MM-DD` | yes | First day of the sales window. |
| `periodTo` | `YYYY-MM-DD` | yes | Last day of the sales window. |
| `weeks` | number | yes | Length of the window, 1–104. |
| `units` | number | yes | Units sold in the window. |
| `unitsYearAgo` | number | yes | Units in the comparable window a year earlier. |
| `velocityVsLastYearPct` | number | yes | Percent change versus `unitsYearAgo`. `8.4` means +8.4%. A negative number is a decline. |
| `storesRanged` | number | yes | Stores that ranged the article in the window. |
| `avgUnitsPerStoreWeek` | number | yes | `units / storesRanged / weeks`. |
| `avgPriceAud` | number | yes | Average selling price in the window. |
| `basketAttachLiftPct` | number | yes | How many extra baskets contain a paired line, versus selling the article alone. |

### `catalogue`

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `asOf` | `YYYY-MM-DD` | yes | Catalogue date. |
| `ranged` | boolean | no | Defaults to true. False means the article is in the history but not on shelf now. |
| `aisle` | string | yes | Where it sits, such as `Spreads`. |
| `shelfPriceAud` | number | yes | Regular shelf price. |
| `promoPriceAud` | number or null | no | Promotional price. Null when it is not on promotion. |
| `promoMechanic` | string or null | no | The ticket, such as `Half price` or `Save $1`. |
| `promoEnds` | `YYYY-MM-DD` or null | no | Last day of the promotion. |
| `pairedWith` | string[] | no | Other article names that are ranged beside it. |
| `attachRatePct` | number | yes | Share of baskets that also contain a paired line. |
| `heroOnlyAttachRatePct` | number | yes | Share of baskets when the article is sold alone. |
| `note` | string | yes | One sentence a buyer would recognise. |

### `competitors[]`

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `retailer` | string | yes | The other banner, such as `Aldi`. |
| `observedAt` | `YYYY-MM-DD` | yes | When the price was seen. |
| `channel` | string | yes | Where it was seen, such as `Online catalogue` or `Store check, 12 stores`. |
| `shelfPriceAud` | number | yes | The price observed. |
| `onPromotion` | boolean | yes | True when a mechanic was on the ticket. |
| `promoMechanic` | string or null | no | The other banner's ticket. |
| `observation` | string | yes | What the checker actually saw. Do not invent a claim that was not on the shelf. |

## How a campaign picks a row

1. The file's retailer name must match the brand name, and the file's country must match the campaign country. Otherwise the file is ignored.
2. A product matches when the campaign product contains the article name, brand or alias, or the other way around. Very short names are ignored.
3. If no product matches, every article in the campaign's category is rolled up. Unit counts are summed. The velocity is recomputed from those units. Catalogue and competitor text come from the first article in that category.
4. If nothing matches, the trend step records a gap and does not invent a figure.

## What the trend step cites

| Section | Source name on the card | What is quoted |
| --- | --- | --- |
| `pos` | `{retailer} POS` | Units, stores, weeks, velocity, average price |
| `catalogue` | `{retailer} catalogue` | Aisle, shelf price, promotion, attach rates, note |
| `competitors` | `{other retailer} competitor check` | Each observed price and the observation sentence |

A pass or a finding from this file is a citation of the uploaded extract. It is not a live warehouse query.

## Minimal example

```json
{
  "schemaVersion": "1.0",
  "retailer": { "id": "example-grocer", "name": "Example Grocer", "country": "AU" },
  "currency": "AUD",
  "extractedAt": "2026-10-19",
  "note": "Weekly extract from our own sales, catalogue and a comp shop.",
  "products": [
    {
      "sku": "100245",
      "name": "Vegemite 220g",
      "brandName": "Vegemite",
      "category": "Grocery",
      "subcategory": "Spreads",
      "aliases": ["vegemite"],
      "pos": {
        "periodFrom": "2025-10-20",
        "periodTo": "2026-10-19",
        "weeks": 52,
        "units": 1689293,
        "unitsYearAgo": 1592171,
        "velocityVsLastYearPct": 6.1,
        "storesRanged": 846,
        "avgUnitsPerStoreWeek": 38.4,
        "avgPriceAud": 4.5,
        "basketAttachLiftPct": 6.2
      },
      "catalogue": {
        "asOf": "2026-10-19",
        "ranged": true,
        "aisle": "Spreads",
        "shelfPriceAud": 4.5,
        "promoPriceAud": 3.5,
        "promoMechanic": "Save $1",
        "promoEnds": "2026-11-03",
        "pairedWith": ["Wonder White Sandwich 700g"],
        "attachRatePct": 22.4,
        "heroOnlyAttachRatePct": 14.8,
        "note": "Save $1 in the current catalogue. Still the default spread."
      },
      "competitors": [
        {
          "retailer": "Woolworths",
          "observedAt": "2026-10-15",
          "channel": "Online catalogue",
          "shelfPriceAud": 4.4,
          "onPromotion": false,
          "promoMechanic": null,
          "observation": "Same 220g jar at $4.40. No price callout on the pantry page."
        }
      ]
    }
  ]
}
```

## Errors

| Condition | Result |
| --- | --- |
| `schemaVersion` is not `"1.0"` | Upload is refused. |
| A required field is missing or a date is not `YYYY-MM-DD` | Upload is refused. The message names the product. |
| Brand name does not match `retailer.name` | File stays on Brand and is not cited. |
| Campaign country does not match `retailer.country` | File is not cited. |
| No product or category matches | A gap is recorded. No figure is filled in. |
