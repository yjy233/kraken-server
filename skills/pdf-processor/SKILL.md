---
name: pdf-processor
description: |
  PDF document processing including text extraction, page manipulation, form handling,
  and metadata editing. Use when the user needs to:
  (1) Extract text or images from PDF files,
  (2) Merge, split, rotate, or reorder PDF pages,
  (3) Fill PDF forms or extract form field data,
  (4) Add watermarks, headers, or footers,
  (5) Convert PDF to/from other formats.
---

# PDF Processor

## Quick Start

### Text Extraction

Use `pdfplumber` for table-aware text extraction:

```python
import pdfplumber

with pdfplumber.open("document.pdf") as pdf:
    for page in pdf.pages:
        text = page.extract_text()
        tables = page.extract_tables()
```

### Page Rotation

Use the bundled script:

```bash
python3 scripts/rotate_pdf.py input.pdf output.pdf --degrees 90
```

### Merge PDFs

```python
from pypdf import PdfWriter

merger = PdfWriter()
for pdf in ["a.pdf", "b.pdf", "c.pdf"]:
    merger.append(pdf)
merger.write("merged.pdf")
merger.close()
```

## Guidelines

- For scanned PDFs (images), first run OCR with `pytesseract`.
- Extract tables with `pdfplumber` rather than raw text when structure matters.
- Preserve metadata when modifying existing PDFs.

## Reference

- Form field extraction: See [references/form-fields.md](references/form-fields.md)
