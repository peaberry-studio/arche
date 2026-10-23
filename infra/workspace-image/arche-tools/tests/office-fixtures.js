import fs from 'node:fs/promises'

import { strToU8, zipSync } from 'fflate'

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>'

function toXml(content) {
  return strToU8(`${XML_HEADER}${content}`)
}

async function writeZipFixture(filePath, entries) {
  const archive = zipSync(entries)
  await fs.writeFile(filePath, Buffer.from(archive))
}

export async function ensureOfficeFixtures(fixturesDir) {
  await fs.mkdir(fixturesDir, { recursive: true })

  const docxPath = `${fixturesDir}/document-test.docx`
  const odtPath = `${fixturesDir}/document-test.odt`
  const pptxPath = `${fixturesDir}/presentation-test.pptx`
  const odpPath = `${fixturesDir}/presentation-test.odp`

  await writeZipFixture(docxPath, {
    '[Content_Types].xml': toXml(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '</Types>',
    ),
    '_rels/.rels': toXml(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
      + '</Relationships>',
    ),
    'word/document.xml': toXml(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + '<w:body>'
      + '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Project Overview</w:t></w:r></w:p>'
      + '<w:p><w:r><w:t>This document summarizes the launch plan.</w:t></w:r></w:p>'
      + '<w:p><w:r><w:t>Next step: review risks and owners.</w:t></w:r></w:p>'
      + '</w:body>'
      + '</w:document>',
    ),
  })

  await writeZipFixture(odtPath, {
    mimetype: [strToU8('application/vnd.oasis.opendocument.text'), { level: 0 }],
    'content.xml': toXml(
      '<office:document-content '
      + 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
      + 'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">'
      + '<office:body><office:text>'
      + '<text:h text:outline-level="1">Open Document Brief</text:h>'
      + '<text:p>ODT body paragraph for the strategy memo.</text:p>'
      + '<text:p>Action item: align owners before kickoff.</text:p>'
      + '</office:text></office:body>'
      + '</office:document-content>',
    ),
    'META-INF/manifest.xml': toXml(
      '<manifest:manifest '
      + 'xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">'
      + '<manifest:file-entry manifest:media-type="application/vnd.oasis.opendocument.text" manifest:full-path="/"/>'
      + '<manifest:file-entry manifest:media-type="text/xml" manifest:full-path="content.xml"/>'
      + '</manifest:manifest>',
    ),
  })

  await writeZipFixture(pptxPath, {
    '[Content_Types].xml': toXml(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
      + '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
      + '</Types>',
    ),
    '_rels/.rels': toXml(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>'
      + '</Relationships>',
    ),
    'ppt/presentation.xml': toXml(
      '<p:presentation '
      + 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
      + 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
      + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>'
      + '</p:presentation>',
    ),
    'ppt/_rels/presentation.xml.rels': toXml(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>'
      + '</Relationships>',
    ),
    'ppt/slides/slide1.xml': toXml(
      '<p:sld '
      + 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
      + 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
      + '<p:cSld><p:spTree>'
      + '<p:sp><p:txBody><a:bodyPr/><a:lstStyle/>'
      + '<a:p><a:r><a:t>Quarterly Review</a:t></a:r></a:p>'
      + '<a:p><a:r><a:t>Revenue up 18 percent</a:t></a:r></a:p>'
      + '</p:txBody></p:sp>'
      + '</p:spTree></p:cSld>'
      + '</p:sld>',
    ),
  })

  await writeZipFixture(odpPath, {
    mimetype: [strToU8('application/vnd.oasis.opendocument.presentation'), { level: 0 }],
    'content.xml': toXml(
      '<office:document-content '
      + 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
      + 'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" '
      + 'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">'
      + '<office:body><office:presentation>'
      + '<draw:page draw:name="slide1">'
      + '<draw:frame><draw:text-box>'
      + '<text:p>Open Deck Title</text:p>'
      + '<text:p>ODP slide body content</text:p>'
      + '</draw:text-box></draw:frame>'
      + '</draw:page>'
      + '</office:presentation></office:body>'
      + '</office:document-content>',
    ),
    'META-INF/manifest.xml': toXml(
      '<manifest:manifest '
      + 'xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">'
      + '<manifest:file-entry manifest:media-type="application/vnd.oasis.opendocument.presentation" manifest:full-path="/"/>'
      + '<manifest:file-entry manifest:media-type="text/xml" manifest:full-path="content.xml"/>'
      + '</manifest:manifest>',
    ),
  })

  return {
    docxPath,
    odtPath,
    pptxPath,
    odpPath,
  }
}
