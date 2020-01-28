//
// a node module that will build the documentation
// scan the pages folder, and reads the configuration json that has the instructions on how to generate the documentation page
// generates a new HTML file, and save it on the /docs folder
//
// input:
// docs path - the generated docs folder, everything inside it will be permenantly deleted first
// project script file - the path to the file that holds the projects javascript code

//1- copy all site folder into the docs dest folder
//2- Scan the src folder for docs sunfolder that has configuration.json file in it
//3- for each such doc folder,
//  3.1= read the configuration file
//	3.2- create page HTML from the page_template file and fill it according to 3.1
//	3.3- create card HTML in that page according the 3.1
//	3.4- create HTML file and copy it to docs dest

module.exports = () => {
	const { promises: fs } = require("fs");
	const fsExtra = require("fs-extra");
	const path = require("path");
	const { JSDOM } = require("jsdom");
	const args = require("minimist")(process.argv.slice(2));
	const escape = require("lodash/escape");

	//{String} destDocsPath - The destination folder path for the documentation website
	const destDocsPath = args["destDocsPath"] || "docs";
	//{String} scriptPath - The project's main script path
	const scriptPath = args["scriptPath"] || "dist/app.min.js";
	//{String} srcPath - The project's source path
	const srcPath = args["srcPath"] || "src";
	//{String} projectName - The project's name
	const projectName = args["projectName"];
	//{String} docsTemplatesPath - The path to the folder that holds all the documentation templates
	const docsTemplatesPath = `${__dirname}${path.sep}templates`;
	//{String} docsTemplatesPath - The path to the folder that holds all the documentation website assets
	const docsAssetsPath = `${__dirname}${path.sep}site_assets`;

	generateDocsWebsite();

	/**
	 * Generates and publish the project's documentation website
	 */
	async function generateDocsWebsite() {
		const startTime = new Date().getTime();
		await copyDocsAssets();
		console.log("copy docs assets ---> [done]");
		await publishDocPages();
		console.log("generate docs pages ---> [done]");
		const endTime = new Date().getTime();
		console.log(`Finished in ${endTime - startTime}ms`);
	}

	/**
	 * Clears the existing docs website and copies the docs assets files to the given path
	 */
	async function copyDocsAssets() {
		try {
			await fsExtra.emptyDir(destDocsPath);
			await fsExtra.copy(docsAssetsPath, destDocsPath);
			await fsExtra.copy(scriptPath, `${destDocsPath}${path.sep}js${path.sep}app.min.js`);
		} catch (err) {
			console.error(err);
		}
	}

	/**
	 * Generates and publish the documentation pages that are found in the project's docs folders
	 */
	async function publishDocPages() {
		const docsConfigurations = await scanForDocs({ currentFolder: srcPath });
		await Promise.all(
			docsConfigurations.map((docsConfig, index) =>
				publishDocPage({
					index,
					docsConfig,
					docsConfigurations
				})
			)
		);
	}

	/**
	 * scans the project's src folder for such subfolder that are named 'docs' with a configuration.json file in them.
	 * returns a list of docs configuration objects
	 *
	 */
	async function scanForDocs({ currentFolder }) {
		const dirents = await fs.readdir(currentFolder, { withFileTypes: true });
		const docsPaths = await Promise.all(
			dirents.map(async dirent => {
				const resolvedPath = path.resolve(currentFolder, dirent.name);
				if (dirent.isDirectory()) {
					if (dirent.name.toLowerCase() === "docs") {
						const docsConfig = await readDocConfig(resolvedPath);
						return { ...docsConfig, docsPath: resolvedPath };
					} else {
						return scanForDocs({ currentFolder: resolvedPath });
					}
				}
				return {};
			})
		);
		return Array.prototype.concat(...docsPaths).filter(docsConfig => docsConfig.id);
	}

	async function publishDocPage({ index, docsConfig, docsConfigurations }) {
		try {
			const pageDOM = await generatePageDOM();
			const pageDocument = pageDOM.window.document;
			generatePageBaseData({
				...docsConfig,
				pageDocument,
				docsConfigurations,
				index
			});
			await generatePageCards({ ...docsConfig, pageDocument });
			publishPage({ ...docsConfig, pageDOM });
		} catch (err) {
			console.log(err);
		}
	}

	async function readDocConfig(docFolderPath) {
		const confText = await fs.readFile(`${docFolderPath}/configuration.json`);
		return JSON.parse(confText);
	}

	async function generatePageDOM() {
		const html = await fs.readFile(`${docsTemplatesPath}/page_template.html`);
		return new JSDOM(html);
	}

	async function publishPage({ id, pageDOM }) {
		await fs.writeFile(`${destDocsPath}${path.sep}${id}.html`, pageDOM.serialize(), "utf8");
	}

	function generatePageBaseData({ category, title, tagName, subtitle, pageDocument, docsConfigurations, index }) {
		const activeNavClass = " navigation__sub--active";
		pageDocument.title = `${projectName} - ${title} <${tagName}>`;
		pageDocument.querySelector("a#main_header_link").innerHTML = `${projectName} Documentation`;
		docsConfigurations.forEach((docsConfig, idx) => {
			const { id, title, tagName, category } = docsConfig;
			const menuItemElement = new JSDOM(
				`<li id="${id}" class="${index === idx ? activeNavClass : ""}"><a href="${id}.html">${title} <code class="info-tag-name">&lt;${tagName}&gt;</code></a></li>`
			).window.document.body.firstChild;
			pageDocument.querySelector(`ul#${category}_menu`).appendChild(menuItemElement);
		});
		pageDocument.querySelector(`li#${category}`).className += activeNavClass;
		pageDocument.querySelector("h1#content_title").innerHTML = `${title} <code class="info-tag-name">&lt;${tagName}&gt;</code>`;
		pageDocument.querySelector("small#content_subtitle").innerHTML = subtitle;
	}

	async function generatePageCards({ cards, docsPath, pageDocument }) {
		const cardsContainerDOM = pageDocument.querySelector("div#cards_container");
		for (let index = 0; index < cards.length; index++) {
			const cardDOM = await generatePageCard({ card: cards[index], docsPath });
			cardsContainerDOM.appendChild(cardDOM);
		}
	}

	async function generatePageCard({ card, docsPath }) {
		const cardTemplateHTML = await fs.readFile(`${docsTemplatesPath}/card_template.html`);
		const contentsHTML = await fs.readFile(`${docsPath}${path.sep}${card.contents}`);
		const cardTemplateDOM = new JSDOM(cardTemplateHTML).window.document.body;
		const contentsDOM = new JSDOM(contentsHTML).window.document;
		const previewContainer = cardTemplateDOM.querySelector("div.example-preview");
		const markupContainer = cardTemplateDOM.querySelector("div.example-markup");
		const additionalInfoContainer = cardTemplateDOM.querySelector("div#additional_info");

		const previewContents = contentsDOM.getElementById("preview");
		const markupContents = contentsDOM.getElementById("markup");
		const additionalInfoContents = contentsDOM.getElementById("additional_info");
		cardTemplateDOM.querySelector("h4.card-title").innerHTML = card.title;
		cardTemplateDOM.querySelector("h6.card-subtitle").innerHTML = card.subtitle;
		setPreviewAndMarkupContents({
			cardTemplateDOM,
			previewContainer,
			markupContainer,
			previewContents,
			markupContents
		});
		setAdditionalInfoContents({ additionalInfoContainer, additionalInfoContents });
		return cardTemplateDOM;
	}
	function setPreviewAndMarkupContents({
		cardTemplateDOM,
		previewContainer,
		markupContainer,
		previewContents,
		markupContents
	}) {
		if (previewContents && markupContents) {
			previewContainer.innerHTML = previewContents.innerHTML;
			markupContainer.children[0].children[0].innerHTML = escape(markupContents.innerHTML);
		} else {
			cardTemplateDOM.querySelector("div.example-container").style.display = "none";
		}
	}
	function setAdditionalInfoContents({ additionalInfoContainer, additionalInfoContents }) {
		if (additionalInfoContents) {
			additionalInfoContainer.innerHTML = additionalInfoContents.innerHTML;
		}
	}
};
