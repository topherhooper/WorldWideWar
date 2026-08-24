"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrPromptProjectAndAppId = void 0;
exports.getOrPromptAppId = getOrPromptAppId;
const apps_1 = require("../management/apps");
const projectUtils_1 = require("../projectUtils");
const appUtils_1 = require("../appUtils");
const error_1 = require("../error");
const logger_1 = require("../logger");
const clc = require("colorette");
async function getOrPromptAppId(options, message = "Select the app to register a debug token for:") {
    const projectId = (0, projectUtils_1.needProjectId)(options);
    logger_1.logger.info(`Active Project: ${clc.bold(projectId)}`);
    if (options.app) {
        return { projectId, appId: options.app };
    }
    const projectDir = options.cwd || process.cwd();
    let apps = await (0, apps_1.listFirebaseApps)(projectId, apps_1.AppPlatform.ANY);
    if (!apps.length) {
        throw new error_1.FirebaseError(`There are no apps associated with project ${projectId}.`);
    }
    const localApps = await (0, appUtils_1.detectApps)(projectDir);
    const localAppIds = localApps.map((a) => a.appId).filter(Boolean);
    if (localAppIds.length > 0) {
        const filteredApps = apps.filter((app) => localAppIds.includes(app.appId));
        if (filteredApps.length > 0) {
            apps = filteredApps;
        }
    }
    if (apps.length === 1) {
        return { projectId, appId: apps[0].appId };
    }
    else if (options.nonInteractive) {
        throw new error_1.FirebaseError(`Project ${projectId} has multiple apps, must specify an app id.`);
    }
    const selectedApp = await (0, apps_1.selectAppInteractively)(apps, apps_1.AppPlatform.ANY, {
        message,
    });
    return { projectId, appId: selectedApp.appId };
}
exports.getOrPromptProjectAndAppId = getOrPromptAppId;
