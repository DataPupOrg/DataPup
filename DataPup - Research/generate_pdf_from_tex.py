#!/usr/bin/env python3
"""
Generate a well-formatted academic PDF from paper.tex using fpdf2.
Parses LaTeX content and renders it with proper academic formatting.
"""

import re
import os
from fpdf import FPDF, XPos, YPos

# ── Paths ──────────────────────────────────────────────────────────────
TEX_PATH = "/Users/kcbalusu/Desktop/Project/DataPup/DataPup - Research/paper.tex"
FIG_DIR  = "/Users/kcbalusu/Desktop/Project/DataPup/evaluation/results/figures"
OUT_PATH = "/Users/kcbalusu/Desktop/Project/DataPup/DataPup - Research/Schema_Aware_Prompt_Engineering_Research_Paper.pdf"


def sanitize_text(text):
    """Remove or replace characters not supported by latin-1 encoding."""
    replacements = {
        '\u2013': '-',   # en dash
        '\u2014': '--',  # em dash
        '\u2018': "'",   # left single quote
        '\u2019': "'",   # right single quote
        '\u201c': '"',   # left double quote
        '\u201d': '"',   # right double quote
        '\u2022': '-',   # bullet
        '\u2026': '...',  # ellipsis
        '\u00a0': ' ',   # non-breaking space
        '\u2192': '->',  # right arrow
        '\u2264': '<=',  # less or equal
        '\u2265': '>=',  # greater or equal
    }
    for char, repl in replacements.items():
        text = text.replace(char, repl)
    # Fallback: replace any remaining non-latin-1 chars
    try:
        text.encode('latin-1')
    except UnicodeEncodeError:
        text = text.encode('latin-1', errors='replace').decode('latin-1')
    return text


def strip_latex(text):
    """Convert inline LaTeX markup to plain text."""
    text = text.replace('\\\\', '\n')
    text = text.replace('\\&', '&')
    text = text.replace('\\%', '%')
    text = text.replace('\\$', '$')
    text = text.replace('\\#', '#')
    text = text.replace('\\_', '_')
    text = text.replace('\\{', '{')
    text = text.replace('\\}', '}')
    text = re.sub(r'\\texttt\{([^}]*)\}', r'\1', text)
    text = re.sub(r'\\textbf\{([^}]*)\}', r'\1', text)
    text = re.sub(r'\\textit\{([^}]*)\}', r'\1', text)
    text = re.sub(r'\\emph\{([^}]*)\}', r'\1', text)
    text = re.sub(r'\\cite\{([^}]*)\}', lambda m: '[' + m.group(1) + ']', text)
    text = re.sub(r'\\ref\{([^}]*)\}', r'[\1]', text)
    text = re.sub(r'\\label\{[^}]*\}', '', text)
    text = re.sub(r'\\url\{([^}]*)\}', r'\1', text)
    text = re.sub(r'\\item\b', '', text)
    # Handle \footnote{...}
    text = re.sub(r'\\footnote\{([^}]*)\}', r' (\1)', text)
    # Remove remaining single-arg commands
    text = re.sub(r'\\[a-zA-Z]+\{([^}]*)\}', r'\1', text)
    # Remove commands with no args like \maketitle
    text = re.sub(r'\\[a-zA-Z]+(?![{a-zA-Z])', '', text)
    text = text.replace('~', ' ')
    text = re.sub(r'\s+', ' ', text)
    return sanitize_text(text.strip())


def parse_tex(path):
    """Parse paper.tex into a list of structured blocks."""
    with open(path, 'r') as f:
        content = f.read()

    blocks = []

    # Extract title
    m = re.search(r'\\vldbTitle\{(.+?)\}', content, re.DOTALL)
    if m:
        blocks.append(('title', strip_latex(m.group(1))))

    # Extract author
    m = re.search(r'\\author\{(.+?)\}', content)
    if m:
        blocks.append(('author', strip_latex(m.group(1))))

    # Extract affiliation
    m = re.search(r'\\institution\{(.+?)\}', content)
    if m:
        blocks.append(('affiliation', strip_latex(m.group(1))))

    # Extract abstract
    m = re.search(r'\\begin\{abstract\}(.+?)\\end\{abstract\}', content, re.DOTALL)
    if m:
        blocks.append(('abstract', strip_latex(m.group(1))))

    # Extract keywords
    m = re.search(r'\\keywords\{(.+?)\}', content, re.DOTALL)
    if m:
        blocks.append(('keywords', strip_latex(m.group(1))))

    # Parse body (after \maketitle, before \end{document})
    body_match = re.search(r'\\maketitle(.+?)\\end\{document\}', content, re.DOTALL)
    if not body_match:
        return blocks

    body = body_match.group(1)

    # Remove comments
    body = re.sub(r'(?m)^%.*$', '', body)
    body = re.sub(r'(?<!\\)%.*$', '', body, flags=re.MULTILINE)

    # ── Extract figures (in order) ──
    figures_ordered = []
    for fm in re.finditer(
        r'\\begin\{figure\}.*?\\includegraphics.*?\{([^}]+)\}.*?\\caption\{(.+?)\}.*?\\end\{figure\}',
        body, re.DOTALL
    ):
        fname = fm.group(1).strip()
        caption = strip_latex(fm.group(2))
        figures_ordered.append(('figure', caption, fname))

    # ── Extract tables (in order) ──
    tables_ordered = []
    for tm in re.finditer(
        r'\\begin\{table\}.*?\\caption\{(.+?)\}.*?\\begin\{tabular\}\{[^}]*\}(.+?)\\end\{tabular\}.*?\\end\{table\}',
        body, re.DOTALL
    ):
        caption = strip_latex(tm.group(1))
        tabular_body = tm.group(2)
        rows = []
        for row_text in re.split(r'\\\\', tabular_body):
            row_text = row_text.strip()
            if not row_text:
                continue
            row_text = re.sub(r'\\(toprule|midrule|bottomrule)', '', row_text).strip()
            if not row_text:
                continue
            cells = [strip_latex(c.strip()) for c in row_text.split('&')]
            if any(c for c in cells):
                rows.append(cells)
        tables_ordered.append(('table', caption, rows))

    # ── Extract bibliography ──
    bib_items = []
    bib_match = re.search(r'\\begin\{thebibliography\}.*?\n(.+?)\\end\{thebibliography\}', body, re.DOTALL)
    if bib_match:
        bib_text = bib_match.group(1)
        for bm in re.finditer(r'\\bibitem\{([^}]*)\}\s*(.+?)(?=\\bibitem|\Z)', bib_text, re.DOTALL):
            key = bm.group(1)
            text = strip_latex(bm.group(2)).strip()
            text = re.sub(r'\s+', ' ', text)
            bib_items.append((key, text))

    # ── Replace float environments with placeholders in body text ──
    cleaned = body
    cleaned = re.sub(r'\\begin\{figure\}.*?\\end\{figure\}', '\n@@FIGURE@@\n', cleaned, flags=re.DOTALL)
    cleaned = re.sub(r'\\begin\{table\}.*?\\end\{table\}', '\n@@TABLE@@\n', cleaned, flags=re.DOTALL)
    cleaned = re.sub(r'\\begin\{thebibliography\}.*?\\end\{thebibliography\}', '\n@@BIBLIOGRAPHY@@\n', cleaned, flags=re.DOTALL)

    # ── Split into segments by section/subsection headers ──
    segment_pattern = re.compile(r'(\\section\{[^}]*\}|\\subsection\{[^}]*\})')
    parts = segment_pattern.split(cleaned)

    fig_idx = 0
    tab_idx = 0

    for part in parts:
        part = part.strip()
        if not part:
            continue

        sec_m = re.match(r'\\section\{([^}]*)\}', part)
        if sec_m:
            blocks.append(('section', strip_latex(sec_m.group(1))))
            continue

        subsec_m = re.match(r'\\subsection\{([^}]*)\}', part)
        if subsec_m:
            blocks.append(('subsection', strip_latex(subsec_m.group(1))))
            continue

        # Content block: split on placeholders
        content_parts = re.split(r'(@@FIGURE@@|@@TABLE@@|@@BIBLIOGRAPHY@@)', part)

        for cp in content_parts:
            cp = cp.strip()
            if not cp:
                continue
            if cp == '@@FIGURE@@':
                if fig_idx < len(figures_ordered):
                    blocks.append(figures_ordered[fig_idx])
                    fig_idx += 1
                continue
            if cp == '@@TABLE@@':
                if tab_idx < len(tables_ordered):
                    blocks.append(tables_ordered[tab_idx])
                    tab_idx += 1
                continue
            if cp == '@@BIBLIOGRAPHY@@':
                blocks.append(('bib_header',))
                for key, text in bib_items:
                    blocks.append(('bibitem', key, text))
                continue

            # Parse itemize/enumerate within content
            list_pattern = re.compile(
                r'(\\begin\{itemize\}|\\end\{itemize\}|\\begin\{enumerate\}|\\end\{enumerate\})'
            )
            list_parts = list_pattern.split(cp)

            in_itemize = False
            in_enumerate = False
            enum_counter = 0

            for lp in list_parts:
                lp = lp.strip()
                if not lp:
                    continue
                if lp == '\\begin{itemize}':
                    in_itemize = True
                    continue
                if lp == '\\end{itemize}':
                    in_itemize = False
                    continue
                if lp == '\\begin{enumerate}':
                    in_enumerate = True
                    enum_counter = 0
                    continue
                if lp == '\\end{enumerate}':
                    in_enumerate = False
                    continue

                if in_itemize:
                    items = re.split(r'\\item\b', lp)
                    for item in items:
                        item = strip_latex(item).strip()
                        if item:
                            blocks.append(('bullet', item))
                elif in_enumerate:
                    items = re.split(r'\\item\b', lp)
                    for item in items:
                        item = strip_latex(item).strip()
                        if item:
                            enum_counter += 1
                            blocks.append(('enum_item', f"{enum_counter}. {item}"))
                else:
                    paragraphs = re.split(r'\n\s*\n', lp)
                    for para in paragraphs:
                        text = strip_latex(para).strip()
                        text = re.sub(r'\s+', ' ', text)
                        if text and len(text) > 3:
                            blocks.append(('paragraph', text))

    return blocks


# ── PDF Generation ─────────────────────────────────────────────────────
class AcademicPDF(FPDF):
    def __init__(self):
        super().__init__('P', 'mm', 'Letter')
        self.set_auto_page_break(auto=True, margin=25)
        self.section_num = 0
        self.subsection_num = 0
        self.set_margins(25.4, 25.4, 25.4)  # 1 inch margins
        self._in_title_page = False
        self.table_counter = 0
        self.figure_counter = 0

    def header(self):
        if self._in_title_page:
            return
        if self.page_no() > 1:
            self.set_font('Times', 'I', 8)
            self.set_y(10)
            self.cell(0, 5, 'Schema-Aware Prompt Engineering for Text-to-SQL in Analytical Databases',
                      new_x=XPos.RIGHT, new_y=YPos.TOP, align='C')
            self.ln(8)

    def footer(self):
        if self._in_title_page:
            return
        self.set_y(-20)
        self.set_font('Times', '', 9)
        self.cell(0, 10, str(self.page_no()),
                  new_x=XPos.RIGHT, new_y=YPos.TOP, align='C')

    def add_title_page(self, title, author, affiliation, abstract, keywords):
        self._in_title_page = True
        self.add_page()

        # Title
        self.ln(30)
        self.set_font('Times', 'B', 18)
        self.multi_cell(0, 8, title, align='C')
        self.ln(8)

        # Author
        self.set_font('Times', '', 12)
        self.cell(0, 6, author, new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='C')
        self.ln(2)

        # Affiliation
        self.set_font('Times', 'I', 11)
        self.cell(0, 6, affiliation, new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='C')
        self.ln(12)

        # Abstract heading
        self.set_font('Times', 'B', 11)
        self.cell(0, 6, 'Abstract', new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='C')
        self.ln(3)

        # Abstract text with narrower margins
        self.set_font('Times', '', 9.5)
        old_l = self.l_margin
        old_r = self.r_margin
        self.set_left_margin(35)
        self.set_right_margin(35)
        self.set_x(35)
        w = self.w - 35 - 35
        self.multi_cell(w, 4.5, abstract, align='J')
        self.set_left_margin(old_l)
        self.set_right_margin(old_r)
        self.ln(6)

        # Keywords
        self.set_font('Times', 'B', 9.5)
        self.set_x(35)
        kw_label = 'Keywords: '
        self.cell(self.get_string_width(kw_label), 5, kw_label,
                  new_x=XPos.RIGHT, new_y=YPos.TOP)
        self.set_font('Times', '', 9.5)
        self.multi_cell(0, 5, keywords)

        self._in_title_page = False

    def add_section(self, title):
        self.section_num += 1
        self.subsection_num = 0
        self.ln(6)

        if self.get_y() > self.h - 40:
            self.add_page()

        self.set_font('Times', 'B', 13)
        numbered = f"{self.section_num}. {title}"
        self.cell(0, 7, numbered.upper(),
                  new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='L')
        self.ln(2)

    def add_subsection(self, title):
        self.subsection_num += 1
        self.ln(4)

        if self.get_y() > self.h - 35:
            self.add_page()

        self.set_font('Times', 'B', 11)
        numbered = f"{self.section_num}.{self.subsection_num} {title}"
        self.cell(0, 6, numbered,
                  new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='L')
        self.ln(1.5)

    def add_paragraph(self, text):
        self.set_font('Times', '', 10)
        self.set_x(self.l_margin + 5)
        w = self.w - self.l_margin - self.r_margin - 5
        self.multi_cell(w, 4.8, text, align='J')
        self.ln(1.5)

    def add_bullet(self, text):
        self.set_font('Times', '', 10)
        indent = self.l_margin + 8
        bullet_w = 5
        self.set_x(indent)
        self.cell(bullet_w, 4.8, '-',
                  new_x=XPos.RIGHT, new_y=YPos.TOP)
        w = self.w - indent - bullet_w - self.r_margin
        self.multi_cell(w, 4.8, text, align='J')
        self.ln(0.8)

    def add_enum_item(self, text):
        self.set_font('Times', '', 10)
        indent = self.l_margin + 8
        self.set_x(indent)
        w = self.w - indent - self.r_margin
        self.multi_cell(w, 4.8, text, align='J')
        self.ln(0.8)

    def add_table(self, caption, rows):
        if not rows:
            return

        self.ln(3)
        self.table_counter += 1

        # Check if enough space
        est_height = (len(rows) + 2) * 6 + 20
        if self.get_y() + est_height > self.h - 30:
            self.add_page()

        # Caption
        self.set_font('Times', 'B', 9)
        self.multi_cell(0, 4.5, f"Table {self.table_counter}: {caption}", align='C')
        self.ln(2)

        num_cols = max(len(r) for r in rows)
        usable_w = self.w - self.l_margin - self.r_margin

        # Calculate column widths based on content length
        col_max_len = [0] * num_cols
        for row in rows:
            for j, cell in enumerate(row):
                if j < num_cols:
                    col_max_len[j] = max(col_max_len[j], len(cell))

        total_chars = sum(col_max_len) or 1
        col_widths = [max(12, (cml / total_chars) * usable_w) for cml in col_max_len]

        total_w = sum(col_widths)
        if total_w > usable_w:
            scale = usable_w / total_w
            col_widths = [w * scale for w in col_widths]

        table_w = sum(col_widths)
        x_start = self.l_margin + (usable_w - table_w) / 2

        # Top rule
        y_pos = self.get_y()
        self.line(x_start, y_pos, x_start + table_w, y_pos)
        self.ln(1)

        # Header row
        if rows:
            self.set_font('Times', 'B', 8.5)
            self.set_x(x_start)
            for j, cell in enumerate(rows[0]):
                if j < num_cols:
                    trunc = cell[:50]
                    self.cell(col_widths[j], 5.5, trunc,
                              new_x=XPos.RIGHT, new_y=YPos.TOP, align='L')
            self.ln(5.5)

            # Mid rule
            y_pos = self.get_y()
            self.line(x_start, y_pos, x_start + table_w, y_pos)
            self.ln(1)

        # Data rows
        self.set_font('Times', '', 8.5)
        for row in rows[1:]:
            self.set_x(x_start)
            for j in range(num_cols):
                cell = row[j] if j < len(row) else ''
                trunc = cell[:50]
                self.cell(col_widths[j], 5, trunc,
                          new_x=XPos.RIGHT, new_y=YPos.TOP, align='L')
            self.ln(5)

        # Bottom rule
        y_pos = self.get_y()
        self.line(x_start, y_pos, x_start + table_w, y_pos)
        self.ln(4)

    def add_figure(self, caption, filename):
        self.figure_counter += 1
        # Convert .pdf to .png
        png_name = filename.replace('.pdf', '.png')
        fig_path = os.path.join(FIG_DIR, png_name)

        if not os.path.exists(fig_path):
            fig_path = os.path.join(FIG_DIR, os.path.basename(png_name))

        if not os.path.exists(fig_path):
            self.ln(3)
            self.set_font('Times', 'I', 9)
            self.cell(0, 5, f"[Figure {self.figure_counter}: {caption} - image not found: {png_name}]",
                      new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='C')
            self.ln(3)
            return

        self.ln(3)

        if self.get_y() > self.h - 100:
            self.add_page()

        usable_w = self.w - self.l_margin - self.r_margin
        img_w = min(usable_w * 0.85, 140)
        x_pos = self.l_margin + (usable_w - img_w) / 2

        try:
            self.image(fig_path, x=x_pos, w=img_w)
        except Exception as e:
            self.set_font('Times', 'I', 9)
            self.cell(0, 5, f"[Figure {self.figure_counter} could not be loaded: {filename}]",
                      new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='C')

        self.ln(2)
        self.set_font('Times', 'I', 9)
        self.multi_cell(0, 4.5, f"Figure {self.figure_counter}: {caption}", align='C')
        self.ln(4)

    def add_bibliography_header(self):
        self.ln(6)
        self.set_font('Times', 'B', 13)
        self.cell(0, 7, 'REFERENCES',
                  new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='L')
        self.ln(2)

    def add_bibitem(self, index, key, text):
        self.set_font('Times', '', 9)
        indent = self.l_margin + 2
        label_w = 10
        self.set_x(indent)
        self.cell(label_w, 4.5, f"[{index}]",
                  new_x=XPos.RIGHT, new_y=YPos.TOP, align='L')
        w = self.w - indent - label_w - self.r_margin
        self.multi_cell(w, 4.5, text, align='J')
        self.ln(1)


def main():
    print("Parsing LaTeX file...")
    blocks = parse_tex(TEX_PATH)
    print(f"  Parsed {len(blocks)} blocks")

    for b in blocks:
        if b[0] in ('section', 'subsection', 'table', 'figure'):
            info = b[1] if len(b) > 1 else ''
            print(f"  [{b[0]}] {info[:70]}")

    pdf = AcademicPDF()

    # Extract title page info
    title = author = affiliation = abstract = keywords = ''
    body_blocks = []
    for b in blocks:
        if b[0] == 'title':
            title = b[1]
        elif b[0] == 'author':
            author = b[1]
        elif b[0] == 'affiliation':
            affiliation = b[1]
        elif b[0] == 'abstract':
            abstract = b[1]
        elif b[0] == 'keywords':
            keywords = b[1]
        else:
            body_blocks.append(b)

    print("Generating title page...")
    pdf.add_title_page(title, author, affiliation, abstract, keywords)

    print("Generating body...")
    pdf.add_page()

    bib_counter = 0
    for b in body_blocks:
        btype = b[0]

        if btype == 'section':
            pdf.add_section(b[1])
        elif btype == 'subsection':
            pdf.add_subsection(b[1])
        elif btype == 'paragraph':
            pdf.add_paragraph(b[1])
        elif btype == 'bullet':
            pdf.add_bullet(b[1])
        elif btype == 'enum_item':
            pdf.add_enum_item(b[1])
        elif btype == 'table':
            pdf.add_table(b[1], b[2])
        elif btype == 'figure':
            pdf.add_figure(b[1], b[2])
        elif btype == 'bib_header':
            pdf.add_bibliography_header()
        elif btype == 'bibitem':
            bib_counter += 1
            pdf.add_bibitem(bib_counter, b[1], b[2])

    print(f"Saving PDF to: {OUT_PATH}")
    pdf.output(OUT_PATH)
    print(f"Done! PDF has {pdf.page_no()} pages.")

    size_kb = os.path.getsize(OUT_PATH) / 1024
    print(f"File size: {size_kb:.1f} KB")


if __name__ == '__main__':
    main()
