declare module "pdfmake/build/pdfmake" {
  type PdfDownloadHandle = {
    download: (
      defaultFileName?: string,
      callback?: () => void,
      options?: unknown,
    ) => void;
  };

  type PdfMakeLike = {
    createPdf: (documentDefinition: unknown) => PdfDownloadHandle;
    addVirtualFileSystem: (vfs: Record<string, string>) => void;
  };

  const pdfMake: PdfMakeLike;
  export default pdfMake;
}

declare module "pdfmake/build/vfs_fonts" {
  const pdfFonts: Record<string, string>;
  export default pdfFonts;
}
