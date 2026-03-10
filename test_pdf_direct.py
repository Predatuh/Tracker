from PyPDF2 import PdfReader

try:
    pdf_path = r"C:\Users\tanne\Desktop\LBD PROGRAM\25-07-01 - IFC - Pierce County -Didar's edits.pdf"
    print(f"Attempting to open: {pdf_path}")
    pdf = PdfReader(pdf_path)
    print(f"Successfully opened PDF")
    print(f"Number of pages: {len(pdf.pages)}")
except Exception as e:
    print(f"Error: {type(e).__name__}: {e}")
    import traceback
    traceback.print_exc()
