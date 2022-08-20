import * as vscode from "vscode";
import { FileFocus } from "./FileFocus";
import { Utils } from "vscode-uri";
import { Group } from "./Group";

export class FileFocusTreeProvider
  implements
    vscode.TreeDataProvider<FocusItem | GroupItem>,
    vscode.TreeDragAndDropController<FocusItem | GroupItem>
{
  dropMimeTypes = ["application/vnd.code.tree.fileFocusTree"];
  dragMimeTypes = ["text/uri-list"];

  constructor(context: vscode.ExtensionContext, private fileFocus: FileFocus) {
    const view = vscode.window.createTreeView("fileFocusTree", {
      treeDataProvider: this,
      showCollapseAll: true,
      canSelectMany: true,
      dragAndDropController: this,
    });
    context.subscriptions.push(view);
  }

  public async handleDrag(
    source: (FocusItem | GroupItem)[],
    treeDataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): Promise<void> {
    /* Only allow dragging Root FocusItems for now.*/
    for (const item of source) {
      if (item.objtype !== "FocusItem") {
        return;
      } else {
        const focusItem = item as FocusItem;
        if (!focusItem.isRootItem) {
          return;
        }
      }
    }

    treeDataTransfer.set(
      "application/vnd.code.tree.fileFocusTree",
      new vscode.DataTransferItem(source)
    );
  }

  public async handleDrop(
    target: FocusItem | undefined,
    sources: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): Promise<void> {
    const transferItem = sources.get("application/vnd.code.tree.fileFocusTree");
    if (!transferItem || !target) {
      return;
    }

    const targetGroup = this.fileFocus.root.get(target.groupId);
    if (!targetGroup) {
      return;
    }

    const treeItems: FocusItem[] = transferItem.value;
    const dirtyGroups = new Set<string>();
    for (const sourceItem of treeItems) {
      const sourceGroup = this.fileFocus.root.get(sourceItem.groupId);
      if (!sourceGroup || sourceGroup.id === targetGroup.id) {
        continue;
      }

      dirtyGroups.add(sourceGroup.id);

      sourceGroup.removeResource(sourceItem.uri);
      targetGroup.addResource(sourceItem.uri);
      this.refresh();
    }

    for (const groupId of dirtyGroups) {
      const group = this.fileFocus.root.get(groupId);
      if (group) {
        this.fileFocus.saveGroup(group);
      }
    }

    this.fileFocus.saveGroup(targetGroup);
  }

  getTreeItem(element: FocusItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
    return element;
  }

  getChildren(element?: any): vscode.ProviderResult<FocusItem[] | GroupItem[]> {
    /* When   is defined the user has picked an element. */
    if (element && element.hasOwnProperty("objtype")) {
      if (element.objtype === "FocusItem") {
        const focusItem = element as FocusItem;
        switch (focusItem.type) {
          case vscode.FileType.Directory: {
            return this.getFolderContents(focusItem.groupId, focusItem.uri);
          }

          case vscode.FileType.File:
          case vscode.FileType.Unknown:
        }
      } else if (element.objtype === "GroupItem") {
        const groupItem = element as GroupItem;
        return this.getResourceForGroup(groupItem.groupId);
      }
    } else {
      return this.getGroupItem();
    }
  }

  private async getResourceForGroup(groupId: string): Promise<FocusItem[]> {
    const out: FocusItem[] = [];
    const resources = this.fileFocus.root.get(groupId)?.resources;
    if (resources) {
      resources.sort((a, b) =>
        Utils.basename(a).localeCompare(Utils.basename(b))
      );

      for (const uri of resources) {
        const fileType = await this.getResourceType(uri);
        switch (fileType) {
          case vscode.FileType.File:
            out.push(
              this.createFileItem(Utils.basename(uri), uri, true, groupId)
            );
            break;

          case vscode.FileType.Directory:
            out.push(
              this.createFolderItem(Utils.basename(uri), uri, true, groupId)
            );
          case vscode.FileType.Unknown:
            out.push(
              this.createUnknownItem(Utils.basename(uri), uri, true, groupId)
            );
        }
      }
    }

    return out;
  }

  private async getResourceType(uri: vscode.Uri) {
    try {
      return await (
        await vscode.workspace.fs.stat(uri)
      ).type;
    } catch (error) {
      return vscode.FileType.Unknown;
    }
  }

  private async getGroupItem(): Promise<GroupItem[]> {
    const out: GroupItem[] = [];
    for (const [id, group] of this.fileFocus.root) {
      out.push(this.createGroupItem(group));
    }

    out.sort((a, b) => a.label.localeCompare(b.label));

    return out;
  }

  private async getFolderContents(
    groupId: string,
    uri: vscode.Uri
  ): Promise<FocusItem[]> {
    const result = await vscode.workspace.fs.readDirectory(uri);

    const out: FocusItem[] = [];
    for (const item of result) {
      const resourceUri = vscode.Uri.joinPath(uri, item[0]);

      switch (item[1]) {
        case vscode.FileType.File:
          out.push(this.createFileItem(item[0], resourceUri, false, groupId));
          break;

        case vscode.FileType.Directory:
          out.push(this.createFolderItem(item[0], resourceUri, false, groupId));
          break;

        default:
      }
    }

    return out;
  }

  private createFileItem(
    label: string,
    uri: vscode.Uri,
    isRootItem: boolean,
    groupId: string
  ) {
    const fileItem = new FocusItem(
      label,
      vscode.FileType.File,
      uri,
      isRootItem,
      groupId,
      vscode.TreeItemCollapsibleState.None
    );
    fileItem.command = {
      command: "vscode.open",
      title: "Open File",
      arguments: [uri],
    };
    fileItem.resourceUri = uri;
    fileItem.iconPath = vscode.ThemeIcon.File;
    fileItem.contextValue = isRootItem ? "FocusRootItem" : "FocusItem";
    return fileItem;
  }

  private createFolderItem(
    label: string,
    uri: vscode.Uri,
    isRootItem: boolean,
    groupId: string
  ) {
    const folderItem = new FocusItem(
      label,
      vscode.FileType.Directory,
      uri,
      isRootItem,
      groupId,
      vscode.TreeItemCollapsibleState.Collapsed
    );
    folderItem.resourceUri = uri;
    folderItem.iconPath = vscode.ThemeIcon.File;
    folderItem.contextValue = isRootItem ? "FocusRootItem" : "FocusItem";
    return folderItem;
  }

  private createUnknownItem(
    label: string,
    uri: vscode.Uri,
    isRootItem: boolean,
    groupId: string
  ) {
    const fileItem = new FocusItem(
      label,
      vscode.FileType.Unknown,
      uri,
      isRootItem,
      groupId,
      vscode.TreeItemCollapsibleState.None
    );
    fileItem.resourceUri = uri;
    fileItem.iconPath = new vscode.ThemeIcon("warning");
    fileItem.contextValue = isRootItem ? "FocusRootItem" : "FocusItem";
    return fileItem;
  }

  private createGroupItem(group: Group) {
    const isFavourite = group.id === this.fileFocus.pinnedGroupId;
    const groupItem = new GroupItem(
      group.name,
      group.id,
      vscode.TreeItemCollapsibleState.Collapsed,
      isFavourite
    );

    return groupItem;
  }

  private _onDidChangeTreeData: vscode.EventEmitter<
    FocusItem | undefined | null | void
  > = new vscode.EventEmitter<FocusItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    FocusItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  async refresh(): Promise<void> {
    this._onDidChangeTreeData.fire();
  }
}

export class FocusItem extends vscode.TreeItem {
  objtype = "FocusItem";
  constructor(
    public readonly label: string,
    public readonly type: vscode.FileType,
    public readonly uri: vscode.Uri,
    public readonly isRootItem: boolean,
    public readonly groupId: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
    this.tooltip = `${uri.fsPath}`;
    this.description = this.getResourceLocationHint(uri);
  }

  private getResourceLocationHint(uri: vscode.Uri) {
    if (this.isRootItem) {
      const parentFolders = uri.path
        .split("/")
        .slice(0, -1)
        .slice(-2)
        .join("/");
      return `[${parentFolders}]`;
    }
  }
}

export class GroupItem extends vscode.TreeItem {
  objtype = "GroupItem";

  constructor(
    public readonly label: string,
    public readonly groupId: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly isFavourite: boolean
  ) {
    super(label, collapsibleState);
    this.contextValue = "GroupItem";
    this.label = this.isFavourite ? `⭐${this.label}` : this.label;
  }
}
