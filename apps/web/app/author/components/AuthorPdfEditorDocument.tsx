"use client";

import { useLayoutEffect, useRef } from "react";
import type {
  AuthorPdfDocumentDraft,
  AuthorPdfPublicationDraft,
} from "../authorPdfExport";

type AuthorPdfEditorDocumentProps = {
  draft: AuthorPdfDocumentDraft;
  locale: string;
  onAddPublication: () => void;
  onDocumentFieldChange: (
    field: Exclude<keyof AuthorPdfDocumentDraft, "publications">,
    value: string,
  ) => void;
  onPublicationFieldChange: (
    publicationId: string,
    field: Exclude<keyof AuthorPdfPublicationDraft, "id">,
    value: string,
  ) => void;
  onRemovePublication: (publicationId: string) => void;
};

type EditableFieldProps = {
  ariaLabel: string;
  className: string;
  multiline?: boolean;
  rows?: number;
  value: string;
  onChange: (value: string) => void;
};

function EditableField({
  ariaLabel,
  className,
  multiline = false,
  rows = 1,
  value,
  onChange,
}: EditableFieldProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    if (!multiline || !textareaRef.current) return;

    textareaRef.current.style.height = "0px";
    textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
  }, [multiline, value]);

  if (multiline) {
    return (
      <textarea
        aria-label={ariaLabel}
        className={className}
        ref={textareaRef}
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <input
      aria-label={ariaLabel}
      className={className}
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function AuthorPdfEditorDocument({
  draft,
  locale,
  onAddPublication,
  onDocumentFieldChange,
  onPublicationFieldChange,
  onRemovePublication,
}: AuthorPdfEditorDocumentProps) {
  const isTurkish = locale.toLocaleLowerCase("tr-TR").startsWith("tr");

  return (
    <section className="pdf-editor-canvas">
      <div className="pdf-editor-document">
        <EditableField
          ariaLabel="Prepared by"
          className="pdf-editor-overline"
          value={draft.preparedBy}
          onChange={(value) => onDocumentFieldChange("preparedBy", value)}
        />

        <EditableField
          ariaLabel="Document title"
          className="pdf-editor-title"
          value={draft.title}
          onChange={(value) => onDocumentFieldChange("title", value)}
        />

        <EditableField
          ariaLabel="Document subtitle"
          className="pdf-editor-subtitle"
          multiline
          rows={2}
          value={draft.subtitle}
          onChange={(value) => onDocumentFieldChange("subtitle", value)}
        />

        <div className="pdf-editor-hero">
          <div className="pdf-editor-hero-main">
            <EditableField
              ariaLabel="Author name"
              className="pdf-editor-hero-name"
              value={draft.authorName}
              onChange={(value) => onDocumentFieldChange("authorName", value)}
            />
            <EditableField
              ariaLabel="Institution"
              className="pdf-editor-hero-affiliation"
              value={draft.institution}
              onChange={(value) => onDocumentFieldChange("institution", value)}
            />
          </div>
          <div className="pdf-editor-hero-total">
            <EditableField
              ariaLabel="Total label"
              className="pdf-editor-meta-label pdf-editor-meta-label-center pdf-editor-hero-total-label"
              multiline
              rows={2}
              value={draft.totalLabel}
              onChange={(value) => onDocumentFieldChange("totalLabel", value)}
            />
            <EditableField
              ariaLabel="Total publications"
              className="pdf-editor-hero-total-value"
              value={draft.total}
              onChange={(value) => onDocumentFieldChange("total", value)}
            />
          </div>
        </div>

        <div className="pdf-editor-info-grid">
          <section className="pdf-editor-panel">
            <EditableField
              ariaLabel="Author information title"
              className="pdf-editor-section-title"
              value={draft.authorInfoTitle}
              onChange={(value) => onDocumentFieldChange("authorInfoTitle", value)}
            />

            <div className="pdf-editor-info-row">
              <EditableField
                ariaLabel="Author label"
                className="pdf-editor-meta-label"
                value={draft.authorLabel}
                onChange={(value) => onDocumentFieldChange("authorLabel", value)}
              />
              <EditableField
                ariaLabel="Author value"
                className="pdf-editor-meta-value"
                value={draft.authorName}
                onChange={(value) => onDocumentFieldChange("authorName", value)}
              />
            </div>

            <div className="pdf-editor-info-row">
              <EditableField
                ariaLabel="Institution label"
                className="pdf-editor-meta-label"
                value={draft.institutionLabel}
                onChange={(value) => onDocumentFieldChange("institutionLabel", value)}
              />
              <EditableField
                ariaLabel="Institution value"
                className="pdf-editor-meta-value"
                value={draft.institution}
                onChange={(value) => onDocumentFieldChange("institution", value)}
              />
            </div>

            <div className="pdf-editor-info-row">
              <EditableField
                ariaLabel="Details label"
                className="pdf-editor-meta-label"
                value={draft.detailsLabel}
                onChange={(value) => onDocumentFieldChange("detailsLabel", value)}
              />
              <EditableField
                ariaLabel="Details value"
                className="pdf-editor-meta-value pdf-editor-meta-value-multiline"
                multiline
                rows={1}
                value={draft.details}
                onChange={(value) => onDocumentFieldChange("details", value)}
              />
            </div>

            <div className="pdf-editor-info-row">
              <EditableField
                ariaLabel="ORCID label"
                className="pdf-editor-meta-label"
                value={draft.orcidLabel}
                onChange={(value) => onDocumentFieldChange("orcidLabel", value)}
              />
              <EditableField
                ariaLabel="ORCID value"
                className="pdf-editor-meta-value"
                value={draft.orcid}
                onChange={(value) => onDocumentFieldChange("orcid", value)}
              />
            </div>
          </section>

          <section className="pdf-editor-panel">
            <EditableField
              ariaLabel="Document information title"
              className="pdf-editor-section-title"
              value={draft.documentInfoTitle}
              onChange={(value) => onDocumentFieldChange("documentInfoTitle", value)}
            />

            <div className="pdf-editor-info-row">
              <EditableField
                ariaLabel="Generated at label"
                className="pdf-editor-meta-label"
                value={draft.generatedAtLabel}
                onChange={(value) => onDocumentFieldChange("generatedAtLabel", value)}
              />
              <EditableField
                ariaLabel="Generated at"
                className="pdf-editor-meta-value"
                value={draft.generatedAt}
                onChange={(value) => onDocumentFieldChange("generatedAt", value)}
              />
            </div>

            <div className="pdf-editor-info-row">
              <EditableField
                ariaLabel="Filter label"
                className="pdf-editor-meta-label"
                value={draft.filterLabel}
                onChange={(value) => onDocumentFieldChange("filterLabel", value)}
              />
              <EditableField
                ariaLabel="Filter value"
                className="pdf-editor-meta-value"
                value={draft.filter}
                onChange={(value) => onDocumentFieldChange("filter", value)}
              />
            </div>

            <div className="pdf-editor-info-row">
              <EditableField
                ariaLabel="Total label"
                className="pdf-editor-meta-label"
                value={draft.totalLabel}
                onChange={(value) => onDocumentFieldChange("totalLabel", value)}
              />
              <EditableField
                ariaLabel="Total value"
                className="pdf-editor-meta-value"
                value={draft.total}
                onChange={(value) => onDocumentFieldChange("total", value)}
              />
            </div>
          </section>
        </div>

        <EditableField
          ariaLabel="Export note"
          className="pdf-editor-note"
          multiline
          rows={1}
          value={draft.exportNote}
          onChange={(value) => onDocumentFieldChange("exportNote", value)}
        />

        <div className="pdf-editor-publication-header">
          <EditableField
            ariaLabel="Publication list title"
            className="pdf-editor-section-title"
            value={draft.publicationListTitle}
            onChange={(value) => onDocumentFieldChange("publicationListTitle", value)}
          />

          <button
            type="button"
            className="pdf-editor-add-btn"
            onClick={onAddPublication}
          >
            {isTurkish ? "Yayın Ekle" : "Add Publication"}
          </button>
        </div>

        <div className="pdf-editor-publication-labels">
          <div className="pdf-editor-publication-label-field">
            <EditableField
              ariaLabel="Authors label"
              className="pdf-editor-meta-label"
              value={draft.rowAuthorsLabel}
              onChange={(value) => onDocumentFieldChange("rowAuthorsLabel", value)}
            />
          </div>
          <div className="pdf-editor-publication-label-field">
            <EditableField
              ariaLabel="Citation label"
              className="pdf-editor-meta-label"
              value={draft.rowVenueLabel}
              onChange={(value) => onDocumentFieldChange("rowVenueLabel", value)}
            />
          </div>
          <div className="pdf-editor-publication-label-field">
            <EditableField
              ariaLabel="DOI label"
              className="pdf-editor-meta-label"
              value={draft.doiLabel}
              onChange={(value) => onDocumentFieldChange("doiLabel", value)}
            />
          </div>
          <div className="pdf-editor-publication-label-field">
            <EditableField
              ariaLabel="Year label"
              className="pdf-editor-meta-label"
              value={draft.yearLabel}
              onChange={(value) => onDocumentFieldChange("yearLabel", value)}
            />
          </div>
        </div>

        <div className="pdf-editor-publications">
          {draft.publications.map((publication, index) => (
            <article key={publication.id} className="pdf-editor-publication-card">
              <div className="pdf-editor-publication-card-head">
                <div className="pdf-editor-publication-index">
                  {String(index + 1).padStart(2, "0")}
                </div>
                <div className="pdf-editor-publication-head-fields">
                  <div className="pdf-editor-publication-compact-field">
                    <span className="pdf-editor-inline-label">{draft.doiLabel}</span>
                    <EditableField
                      ariaLabel="DOI value"
                      className="pdf-editor-inline-chip-value"
                      value={publication.doi}
                      onChange={(value) =>
                        onPublicationFieldChange(publication.id, "doi", value)
                      }
                    />
                  </div>
                  <div className="pdf-editor-publication-compact-field is-year">
                    <span className="pdf-editor-inline-label">{draft.yearLabel}</span>
                    <EditableField
                      ariaLabel="Year value"
                      className="pdf-editor-inline-chip-value is-year"
                      value={publication.year}
                      onChange={(value) =>
                        onPublicationFieldChange(publication.id, "year", value)
                      }
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className="pdf-editor-remove-btn"
                  onClick={() => onRemovePublication(publication.id)}
                >
                  {isTurkish ? "Kaldır" : "Remove"}
                </button>
              </div>

              <EditableField
                ariaLabel="Publication title"
                className="pdf-editor-publication-title"
                multiline
                rows={1}
                value={publication.title}
                onChange={(value) =>
                  onPublicationFieldChange(publication.id, "title", value)
                }
              />

              <div className="pdf-editor-publication-grid">
                <div className="pdf-editor-publication-grid-item">
                  <span className="pdf-editor-inline-label">{draft.rowAuthorsLabel}</span>
                  <EditableField
                    ariaLabel="Authors value"
                    className="pdf-editor-inline-value"
                    multiline
                    rows={1}
                    value={publication.authors}
                    onChange={(value) =>
                      onPublicationFieldChange(publication.id, "authors", value)
                    }
                  />
                </div>

                <div className="pdf-editor-publication-grid-item">
                  <span className="pdf-editor-inline-label">{draft.rowVenueLabel}</span>
                  <EditableField
                    ariaLabel="Citation value"
                    className="pdf-editor-inline-value"
                    multiline
                    rows={1}
                    value={publication.citation}
                    onChange={(value) =>
                      onPublicationFieldChange(publication.id, "citation", value)
                    }
                  />
                </div>
              </div>

              <div className="pdf-editor-publication-supporting">
                <EditableField
                  ariaLabel="Publication metadata"
                  className="pdf-editor-publication-meta"
                  multiline
                  rows={1}
                  value={publication.metadata}
                  onChange={(value) =>
                    onPublicationFieldChange(publication.id, "metadata", value)
                  }
                />

                <EditableField
                  ariaLabel="Publication keywords"
                  className="pdf-editor-publication-meta"
                  multiline
                  rows={1}
                  value={publication.keywords}
                  onChange={(value) =>
                    onPublicationFieldChange(publication.id, "keywords", value)
                  }
                />
              </div>
            </article>
          ))}
        </div>

        <EditableField
          ariaLabel="Declaration"
          className="pdf-editor-declaration"
          multiline
          rows={2}
          value={draft.declaration}
          onChange={(value) => onDocumentFieldChange("declaration", value)}
        />
      </div>
    </section>
  );
}
