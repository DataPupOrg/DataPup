#!/usr/bin/env python3
"""
Convert the Schema-Aware Prompt Engineering research paper from text to PDF.
Uses fpdf2 library with a Unicode TTF font for full character support.
"""

import os
import re
from fpdf import FPDF

# ---------------------------------------------------------------------------
# Constants / paths
# ---------------------------------------------------------------------------
INPUT_TXT = "/Users/kcbalusu/Desktop/Project/DataPup/DataPup - Research/Schema_Aware_Prompt_Engineering_Research_Paper_Draft.txt"
OUTPUT_PDF = "/Users/kcbalusu/Desktop/Project/DataPup/DataPup - Research/Schema_Aware_Prompt_Engineering_Research_Paper.pdf"
FIGURES_DIR = "/Users/kcbalusu/Desktop/Project/DataPup/evaluation/results/figures"

# Figure placement: (figure_filename, trigger_key)
FIGURE_PLACEMENTS = [
    ("fig1_format_comparison.png", "TABLE_1_END"),
    ("fig2_scope_comparison.png", "TABLE_4_END"),
    ("fig3_metadata_comparison.png", "TABLE_6_END"),
    ("fig4_example_comparison.png", "TABLE_8_END"),
    ("fig5_token_efficiency.png", "SECTION_5_5_END"),
    ("fig6_category_heatmap.png", "SECTION_6_HEATMAP"),
]

FIGURE_CAPTIONS = {
    "fig1_format_comparison.png": "Figure 1: Schema Format Comparison -- Execution Accuracy and Result Correctness across four representation formats.",
    "fig2_scope_comparison.png": "Figure 2: Schema Scope Comparison -- Execution Accuracy and Result Correctness across four scope strategies.",
    "fig3_metadata_comparison.png": "Figure 3: Metadata Enrichment Comparison -- Performance impact of different metadata types.",
    "fig4_example_comparison.png": "Figure 4: Example Strategy Comparison -- Zero-shot vs. few-shot performance across strategies.",
    "fig5_token_efficiency.png": "Figure 5: Token Efficiency Analysis -- Relationship between token cost and performance across all configurations.",
    "fig6_category_heatmap.png": "Figure 6: Category-Level Performance Heatmap -- Execution Accuracy by query category and configuration.",
}

# Known section titles (to prevent false positives from numbered list items)
KNOWN_SECTIONS = {
    "1": "Introduction",
    "2": "Background and Motivation",
    "3": "Methodology",
    "4": "Experimental Setup",
    "5": "Results",
    "6": "Discussion",
    "7": "Related Work",
    "8": "Conclusion",
}


# ---------------------------------------------------------------------------
# Sanitise text -- replace Unicode chars that may cause issues with some fonts
# ---------------------------------------------------------------------------
def sanitize(text):
    """Replace problematic Unicode characters with safe alternatives."""
    text = text.replace("\u2014", "--")     # em-dash
    text = text.replace("\u2013", "-")      # en-dash
    text = text.replace("\u2018", "'")      # left single quote
    text = text.replace("\u2019", "'")      # right single quote
    text = text.replace("\u201c", '"')      # left double quote
    text = text.replace("\u201d", '"')      # right double quote
    text = text.replace("\u2026", "...")    # ellipsis
    text = text.replace("\u2192", "->")    # right arrow
    text = text.replace("\u2022", "-")      # bullet (we render our own)
    text = text.replace("\u00a0", " ")      # non-breaking space
    return text


# ---------------------------------------------------------------------------
# PDF subclass
# ---------------------------------------------------------------------------
class ResearchPaperPDF(FPDF):
    """Custom PDF class with page numbers and margins for a research paper."""

    def __init__(self):
        super().__init__(orientation="P", unit="mm", format="letter")
        self.set_auto_page_break(auto=True, margin=25)
        self.set_margins(left=25, top=25, right=25)
        self.alias_nb_pages()

    def footer(self):
        self.set_y(-15)
        self.set_font("Times", "I", 9)
        self.set_text_color(100, 100, 100)
        self.cell(0, 10, f"Page {self.page_no()}/{{nb}}", align="C")

    def vspace(self, h=4):
        self.ln(h)

    # -- Title --
    def add_title(self, title_lines):
        self.set_font("Times", "B", 16)
        self.set_text_color(0, 0, 0)
        title = sanitize(" ".join(title_lines))
        self.multi_cell(0, 7, title, align="C")
        self.vspace(3)

    # -- Authors --
    def add_authors(self, author_lines):
        self.set_font("Times", "", 11)
        self.set_text_color(0, 0, 0)
        for line in author_lines:
            self.cell(0, 5, sanitize(line.strip()), align="C",
                      new_x="LMARGIN", new_y="NEXT")
        self.vspace(6)

    # -- Section header ("1. Introduction") --
    def add_section_header(self, text):
        self.vspace(6)
        self.set_font("Times", "B", 13)
        self.set_text_color(0, 0, 0)
        self.multi_cell(0, 6, sanitize(text))
        self.vspace(2)

    # -- Subsection header ("2.1 ...") --
    def add_subsection_header(self, text):
        self.vspace(4)
        self.set_font("Times", "B", 11)
        self.set_text_color(0, 0, 0)
        self.multi_cell(0, 5.5, sanitize(text))
        self.vspace(1.5)

    # -- Abstract --
    def add_abstract_header(self):
        self.vspace(2)
        self.set_font("Times", "B", 12)
        self.set_text_color(0, 0, 0)
        self.cell(0, 6, "Abstract", align="C",
                  new_x="LMARGIN", new_y="NEXT")
        self.vspace(2)

    def add_abstract_body(self, text):
        self.set_font("Times", "I", 10)
        self.set_text_color(30, 30, 30)
        x = self.l_margin + 8
        w = self.w - self.l_margin - self.r_margin - 16
        self.set_x(x)
        self.multi_cell(w, 4.5, sanitize(text))
        self.vspace(2)

    # -- Keywords --
    def add_keywords(self, text):
        self.set_font("Times", "B", 10)
        self.set_text_color(0, 0, 0)
        x = self.l_margin + 8
        w = self.w - self.l_margin - self.r_margin - 16
        self.set_x(x)
        self.cell(18, 4.5, "Keywords: ", new_x="END")
        self.set_font("Times", "I", 10)
        kw = sanitize(text.replace("Keywords:", "").replace("Keywords", "").strip())
        self.multi_cell(w - 18, 4.5, kw)
        self.vspace(4)
        self.set_draw_color(160, 160, 160)
        y = self.get_y()
        self.line(self.l_margin, y, self.w - self.r_margin, y)
        self.vspace(4)

    # -- Body paragraph --
    def add_body_text(self, text):
        self.set_font("Times", "", 10.5)
        self.set_text_color(0, 0, 0)
        self.multi_cell(0, 4.5, sanitize(text))
        self.vspace(1.5)

    # -- Bullet point --
    def add_bullet(self, text):
        self.set_font("Times", "", 10.5)
        self.set_text_color(0, 0, 0)
        indent = 8
        bullet_w = 5
        x = self.l_margin + indent
        w = self.w - self.l_margin - self.r_margin - indent - bullet_w
        self.set_x(x)
        # Use a simple dash as bullet since core fonts lack bullet char
        self.cell(bullet_w, 4.5, "- ", new_x="END")
        self.multi_cell(w, 4.5, sanitize(text.strip()))
        self.vspace(0.5)

    # -- Numbered list item --
    def add_numbered_item(self, number, text):
        self.set_font("Times", "", 10.5)
        self.set_text_color(0, 0, 0)
        indent = 8
        num_w = 8
        x = self.l_margin + indent
        w = self.w - self.l_margin - self.r_margin - indent - num_w
        self.set_x(x)
        self.cell(num_w, 4.5, f"{number}.", new_x="END")
        self.multi_cell(w, 4.5, sanitize(text.strip()))
        self.vspace(0.5)

    # -- Finding block (indented, with colored label) --
    def add_finding(self, finding_num, text):
        self.vspace(2)
        x = self.l_margin + 5
        w = self.w - self.l_margin - self.r_margin - 10
        self.set_x(x)
        # Bold label
        self.set_font("Times", "B", 10.5)
        self.set_text_color(0, 0, 120)
        label = f"Finding {finding_num}: "
        label_w = self.get_string_width(label) + 1
        self.cell(label_w, 4.5, label, new_x="END")
        # Body
        self.set_font("Times", "", 10.5)
        self.set_text_color(30, 30, 30)
        self.multi_cell(w - label_w, 4.5, sanitize(text))
        self.vspace(2)

    # -- Table caption --
    def add_table_caption(self, text):
        self.vspace(3)
        self.set_font("Times", "B", 10)
        self.set_text_color(0, 0, 0)
        self.multi_cell(0, 5, sanitize(text))
        self.vspace(1)

    # -- Table data block (monospace on shaded background) --
    def add_table_block(self, lines):
        self.set_font("Courier", "", 8)
        self.set_text_color(30, 30, 30)
        self.set_fill_color(248, 248, 248)
        x_start = self.l_margin + 2
        w = self.w - self.l_margin - self.r_margin - 4

        for ln in lines:
            if self.get_y() + 4 > self.h - 25:
                self.add_page()
            self.set_x(x_start)
            self.cell(w, 3.8, sanitize(ln), fill=True,
                      new_x="LMARGIN", new_y="NEXT")
        self.vspace(2)

    # -- Reference entry --
    def add_reference(self, text):
        self.set_font("Times", "", 9)
        self.set_text_color(0, 0, 0)
        indent = 5
        x = self.l_margin + indent
        w = self.w - self.l_margin - self.r_margin - indent
        m = re.match(r"(\[\d+\])\s*(.*)", text)
        if m:
            label, body = m.group(1), m.group(2)
            self.set_x(x)
            self.set_font("Times", "B", 9)
            lw = self.get_string_width(label) + 2
            self.cell(lw, 4, label, new_x="END")
            self.set_font("Times", "", 9)
            self.multi_cell(w - lw, 4, sanitize(body))
        else:
            self.set_x(x)
            self.multi_cell(w, 4, sanitize(text))
        self.vspace(0.5)

    # -- Figure insertion --
    def add_figure(self, img_path, caption):
        self.vspace(4)
        avail_w = self.w - self.l_margin - self.r_margin - 10
        img_w = min(avail_w, 150)
        x = self.l_margin + (self.w - self.l_margin - self.r_margin - img_w) / 2
        if self.get_y() + 80 > self.h - 25:
            self.add_page()
        self.image(img_path, x=x, w=img_w)
        self.vspace(2)
        self.set_font("Times", "I", 9)
        self.set_text_color(60, 60, 60)
        self.multi_cell(0, 4, sanitize(caption), align="C")
        self.set_text_color(0, 0, 0)
        self.vspace(4)


# ---------------------------------------------------------------------------
# Helpers for the parser
# ---------------------------------------------------------------------------
def is_section_header(stripped):
    """Return True if *stripped* is a genuine top-level section header."""
    m = re.match(r"^(\d+)\.\s+(.*)", stripped)
    if not m:
        return False
    num = m.group(1)
    rest = m.group(2).strip()
    # Must be a known section number OR the rest starts with a capital letter
    # AND the number is single-digit (sections are 1-8).
    if num in KNOWN_SECTIONS:
        return True
    # Numbered list items are always preceded by whitespace in the raw line
    # and usually have lowercase or descriptive text.  Section headers are
    # flush-left with a title-case title.
    if int(num) <= 8 and rest and rest[0].isupper():
        return True
    return False


def is_subsection_header(stripped):
    """Return True if *stripped* looks like 'N.M Title'."""
    m = re.match(r"^(\d+\.\d+)\s+(.*)", stripped)
    if not m:
        return False
    rest = m.group(2).strip()
    return bool(rest) and rest[0].isupper()


# ---------------------------------------------------------------------------
# Parse the text file into structured blocks
# ---------------------------------------------------------------------------
def parse_paper(filepath):
    with open(filepath, "r", encoding="utf-8") as f:
        raw = f.read()

    lines = raw.split("\n")
    blocks = []
    i = 0
    total = len(lines)

    # ---- Title (lines 0-1) ----
    blocks.append(("TITLE", [lines[0].strip(), lines[1].strip()]))
    i = 2

    # ---- Authors (lines 2-5) ----
    author_lines = []
    while i < 6:
        line = lines[i].strip()
        if line:
            author_lines.append(line)
        i += 1
    blocks.append(("AUTHORS", author_lines))

    # State for table parsing
    in_table_block = False
    table_lines_buf = []
    table_caption = ""
    current_table_num = None

    while i < total:
        line = lines[i]
        stripped = line.strip()

        # --- blank line ---
        if not stripped:
            if in_table_block and table_lines_buf:
                blocks.append(("TABLE_CAPTION", table_caption))
                blocks.append(("TABLE", list(table_lines_buf)))
                if current_table_num:
                    blocks.append(("FIGURE_TRIGGER",
                                   f"TABLE_{current_table_num}_END"))
                table_lines_buf = []
                in_table_block = False
                table_caption = ""
                current_table_num = None
            i += 1
            continue

        # --- Abstract ---
        if stripped == "Abstract":
            blocks.append(("ABSTRACT_HEADER", ""))
            i += 1
            abstract_parts = []
            while i < total:
                aline = lines[i].strip()
                if aline.startswith("Keywords"):
                    blocks.append(("ABSTRACT_BODY", " ".join(abstract_parts)))
                    blocks.append(("KEYWORDS", aline))
                    i += 1
                    break
                elif is_section_header(aline):
                    blocks.append(("ABSTRACT_BODY", " ".join(abstract_parts)))
                    break
                elif aline:
                    abstract_parts.append(aline)
                    i += 1
                else:
                    i += 1
            continue

        # --- Numbered list items (indented "  1. ..." or "  2. ...") ---
        # Must come BEFORE section-header check to avoid false positives.
        numlist_match = re.match(r"^(\s{2,})(\d+)\.\s+(.*)", line)
        if numlist_match:
            num = numlist_match.group(2)
            item_text = numlist_match.group(3).strip()
            i += 1
            while i < total:
                nline = lines[i]
                ns = nline.strip()
                if not ns:
                    break
                if re.match(r"^\s{2,}\d+\.\s", nline):
                    break
                if is_section_header(ns):
                    break
                if is_subsection_header(ns):
                    break
                if re.match(r"^[\t\s]*\u2022\s", ns):
                    break
                item_text += " " + ns
                i += 1
            blocks.append(("NUMBERED_ITEM", (num, item_text)))
            continue

        # --- Section header ---
        if is_section_header(stripped):
            blocks.append(("SECTION", stripped))
            i += 1
            continue

        # --- Subsection header ---
        if is_subsection_header(stripped):
            blocks.append(("SUBSECTION", stripped))
            i += 1
            continue

        # --- Table caption: "Table N: ..." ---
        table_cap_match = re.match(r"^Table\s+(\d+):\s*(.*)", stripped)
        if table_cap_match:
            current_table_num = table_cap_match.group(1)
            table_caption = stripped
            in_table_block = True
            table_lines_buf = []
            i += 1
            continue

        # --- Inside a table block ---
        if in_table_block:
            table_lines_buf.append(stripped)
            i += 1
            continue

        # --- Inline benchmark table (Category / Count / Challenge Focus) ---
        if stripped == "Category" and i + 1 < total and \
                lines[i + 1].strip() == "Count":
            bench = []
            while i < total and lines[i].strip():
                bench.append(lines[i].strip())
                i += 1
            formatted = [f"{'Category':<22} {'Count':>5}  {'Challenge Focus'}"]
            formatted.append("-" * 60)
            j = 3
            while j + 2 < len(bench):
                formatted.append(
                    f"{bench[j]:<22} {bench[j+1]:>5}  {bench[j+2]}")
                j += 3
            blocks.append(("TABLE_CAPTION", "Table: Benchmark Query Distribution"))
            blocks.append(("TABLE", formatted))
            continue

        # --- Finding ---
        finding_match = re.match(r"^Finding\s+(\d+):\s*(.*)", stripped)
        if finding_match:
            fnum = finding_match.group(1)
            ftxt = finding_match.group(2)
            i += 1
            while i < total:
                ns = lines[i].strip()
                if not ns:
                    break
                if re.match(r"^Finding\s+\d+:", ns):
                    break
                if re.match(r"^Table\s+\d+:", ns):
                    break
                if is_section_header(ns):
                    break
                if is_subsection_header(ns):
                    break
                ftxt += " " + ns
                i += 1
            blocks.append(("FINDING", (fnum, ftxt)))
            continue

        # --- Reference: "[N] ..." ---
        ref_match = re.match(r"^\[(\d+)\]\s*(.*)", stripped)
        if ref_match:
            rtxt = stripped
            i += 1
            while i < total:
                ns = lines[i].strip()
                if not ns or re.match(r"^\[\d+\]", ns):
                    break
                rtxt += " " + ns
                i += 1
            blocks.append(("REFERENCE", rtxt))
            continue

        # --- "References" heading ---
        if stripped == "References":
            blocks.append(("SECTION", "References"))
            i += 1
            continue

        # --- Bullet points (using Unicode bullet or tab-bullet) ---
        bullet_match = re.match(r"^[\t\s]*\u2022\s*(.*)", stripped)
        if bullet_match:
            btxt = bullet_match.group(1).strip()
            i += 1
            while i < total:
                ns = lines[i].strip()
                if not ns:
                    break
                if re.match(r"^[\t\s]*\u2022\s", ns):
                    break
                if is_section_header(ns):
                    break
                if is_subsection_header(ns):
                    break
                if re.match(r"^Finding\s+\d+:", ns):
                    break
                if re.match(r"^Table\s+\d+:", ns):
                    break
                btxt += " " + ns
                i += 1
            blocks.append(("BULLET", btxt))
            continue

        # --- Format sub-headers: "Format A: ..." ---
        if re.match(r"^Format [A-D]:", stripped):
            blocks.append(("SUBSECTION", stripped))
            i += 1
            continue

        # --- Regular paragraph (fallback) ---
        ptxt = stripped
        i += 1
        while i < total:
            nline = lines[i]
            ns = nline.strip()
            if not ns:
                break
            if is_section_header(ns):
                break
            if is_subsection_header(ns):
                break
            if re.match(r"^Finding\s+\d+:", ns):
                break
            if re.match(r"^Table\s+\d+:", ns):
                break
            if re.match(r"^[\t\s]*\u2022\s", ns):
                break
            if re.match(r"^\[\d+\]", ns):
                break
            if ns == "References":
                break
            if re.match(r"^Format [A-D]:", ns):
                break
            if ns == "Abstract":
                break
            if re.match(r"^\s{2,}\d+\.\s", nline):
                break
            ptxt += " " + ns
            i += 1
        blocks.append(("PARAGRAPH", ptxt))

    return blocks


# ---------------------------------------------------------------------------
# Build the PDF
# ---------------------------------------------------------------------------
def build_pdf(blocks, output_path):
    pdf = ResearchPaperPDF()
    pdf.add_page()

    pending_figures = {
        trigger: (fname, FIGURE_CAPTIONS[fname])
        for fname, trigger in FIGURE_PLACEMENTS
    }
    fig5_inserted = False
    fig6_inserted = False

    for idx, (btype, content) in enumerate(blocks):
        if btype == "TITLE":
            pdf.add_title(content)

        elif btype == "AUTHORS":
            pdf.add_authors(content)

        elif btype == "ABSTRACT_HEADER":
            pdf.add_abstract_header()

        elif btype == "ABSTRACT_BODY":
            pdf.add_abstract_body(content)

        elif btype == "KEYWORDS":
            pdf.add_keywords(content)

        elif btype == "SECTION":
            # Insert fig5 before Section 6
            if (content.startswith("6.") or content == "6. Discussion") \
                    and not fig5_inserted:
                info = pending_figures.get("SECTION_5_5_END")
                if info:
                    pdf.add_figure(f"{FIGURES_DIR}/{info[0]}", info[1])
                    fig5_inserted = True
            pdf.add_section_header(content)

        elif btype == "SUBSECTION":
            # Insert fig6 before subsection 6.3
            if content.startswith("6.3") and not fig6_inserted:
                info = pending_figures.get("SECTION_6_HEATMAP")
                if info:
                    pdf.add_figure(f"{FIGURES_DIR}/{info[0]}", info[1])
                    fig6_inserted = True
            pdf.add_subsection_header(content)

        elif btype == "PARAGRAPH":
            pdf.add_body_text(content)

        elif btype == "BULLET":
            pdf.add_bullet(content)

        elif btype == "NUMBERED_ITEM":
            num, text = content
            pdf.add_numbered_item(num, text)

        elif btype == "FINDING":
            fnum, text = content
            pdf.add_finding(fnum, text)

        elif btype == "TABLE_CAPTION":
            pdf.add_table_caption(content)

        elif btype == "TABLE":
            pdf.add_table_block(content)

        elif btype == "FIGURE_TRIGGER":
            trigger = content
            if trigger in pending_figures:
                fname, caption = pending_figures[trigger]
                pdf.add_figure(f"{FIGURES_DIR}/{fname}", caption)

        elif btype == "REFERENCE":
            pdf.add_reference(content)

    pdf.output(output_path)
    print(f"PDF generated: {output_path}")
    print(f"Total pages: {pdf.page_no()}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    blocks = parse_paper(INPUT_TXT)

    # Debug summary
    for i, (btype, content) in enumerate(blocks):
        if btype in ("TABLE_CAPTION", "FIGURE_TRIGGER", "SECTION",
                      "SUBSECTION", "FINDING", "NUMBERED_ITEM"):
            preview = content if isinstance(content, str) else str(content)[:80]
            print(f"  [{i:3d}] {btype:20s} | {preview}")

    print()
    build_pdf(blocks, OUTPUT_PDF)
