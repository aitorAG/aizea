"""Generate a small structured PDF for integration testing of LayoutParser.

Creates a 4-page document with 4 outline-bookmarked section headers:
  1. Introduction
  2. Methods
     2.1 Data Collection
  3. Conclusion

The bookmarks make docling detect them as section_header items.
"""

from fpdf import FPDF

OUT = r"C:\Users\PC\Proyectos\AIzea\aizea\tests\fixtures\structured-doc.pdf"


class StructuredPDF(FPDF):
    def header(self):
        pass

    def chapter(self, title: str, level: int = 0):
        if level == 0:
            self.set_font("Helvetica", "B", 20)
        else:
            self.set_font("Helvetica", "B", 16)
        self.ln(15)
        self.cell(0, 12, title, new_x="LMARGIN", new_y="NEXT")
        self.set_font("Helvetica", "", 12)
        body = (
            "This is sample body text used to give the page some content. "
            "Docling will detect the heading above from the bookmark and font size. "
        )
        self.multi_cell(0, 6, body)


pdf = StructuredPDF()
pdf.set_auto_page_break(auto=True, margin=15)

# fpdf2 uses insert_toc_page + render_toc + section/bookmark via start_section
# The 2.x API uses pdf.start_section(name, level) which creates a PDF outline entry.

pdf.add_page()
pdf.start_section("1. Introduction", level=0)
pdf.set_font("Helvetica", "B", 20)
pdf.cell(0, 12, "1. Introduction", new_x="LMARGIN", new_y="NEXT")
pdf.set_font("Helvetica", "", 12)
pdf.multi_cell(
    0,
    6,
    "This is the introduction. It explains the motivation and goals of the document. "
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
)

pdf.add_page()
pdf.start_section("2. Methods", level=0)
pdf.set_font("Helvetica", "B", 20)
pdf.cell(0, 12, "2. Methods", new_x="LMARGIN", new_y="NEXT")
pdf.set_font("Helvetica", "", 12)
pdf.multi_cell(
    0,
    6,
    "This section describes the methodology used in our study. "
    "We followed standard scientific practice.",
)

pdf.add_page()
pdf.start_section("2.1 Data Collection", level=1)
pdf.set_font("Helvetica", "B", 16)
pdf.cell(0, 12, "2.1 Data Collection", new_x="LMARGIN", new_y="NEXT")
pdf.set_font("Helvetica", "", 12)
pdf.multi_cell(
    0,
    6,
    "Data was collected from multiple sources. Each source is described in detail below. "
    "The collection process was iterative.",
)

pdf.add_page()
pdf.start_section("3. Conclusion", level=0)
pdf.set_font("Helvetica", "B", 20)
pdf.cell(0, 12, "3. Conclusion", new_x="LMARGIN", new_y="NEXT")
pdf.set_font("Helvetica", "", 12)
pdf.multi_cell(
    0,
    6,
    "Summary of findings. The methodology produced consistent results.",
)

pdf.output(OUT)
print(f"Wrote: {OUT}")
