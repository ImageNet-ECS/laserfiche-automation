const validate = require('./validate');
const picker = require('./picker');
const resourcesTab = require('./resources-tab');
const editor = require('./editor');

// Bind the selector config into every Laserfiche action so task code can call
// them without threading `sel` through each call site.
function makeLaserfiche(sel) {
  return {
    parseResourceLine: validate.parseResourceLine,
    extractMissingResources: (page) => validate.extractMissingResources(page, sel),
    dismissValidationToast: (page) => validate.dismissValidationToast(page, sel),
    revalidateAndWaitForSettled: (page) => validate.revalidateAndWaitForSettled(page, sel),
    sessionLooksValid: (page, protectedUrl) => validate.sessionLooksValid(page, protectedUrl, sel),
    gotoWarningView: (page) => validate.gotoWarningView(page, sel),

    clickMenuItem: (page, label) => picker.clickMenuItem(page, label, sel),
    openInsertMenu: (page, menuPath) => picker.openInsertMenu(page, menuPath, sel),
    insertViaEnvSearchPicker: (page, opts) => picker.insertViaEnvSearchPicker(page, opts, sel),

    gotoResourcesTab: (page) => resourcesTab.gotoResourcesTab(page, sel),
    removeResourceByName: (page, name, project) => resourcesTab.removeResourceByName(page, name, project, sel),
    removeResourcesExceptType: (page, keepTypeLabel) => resourcesTab.removeResourcesExceptType(page, keepTypeLabel, sel),

    clickSave: (page) => editor.clickSave(page, sel),
  };
}

module.exports = { makeLaserfiche };
