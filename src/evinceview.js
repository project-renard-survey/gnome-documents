/*
 * Copyright (c) 2011, 2015 Red Hat, Inc.
 *
 * Gnome Documents is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by the
 * Free Software Foundation; either version 2 of the License, or (at your
 * option) any later version.
 *
 * Gnome Documents is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License
 * for more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with Gnome Documents; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
 *
 * Author: Cosimo Cecchi <cosimoc@redhat.com>
 *
 */

const EvDocument = imports.gi.EvinceDocument;
const EvView = imports.gi.EvinceView;
const GdPrivate = imports.gi.GdPrivate;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const _ = imports.gettext.gettext;

const Lang = imports.lang;
const Mainloop = imports.mainloop;

const Application = imports.application;
const MainToolbar = imports.mainToolbar;
const Places = imports.places;
const Preview = imports.preview;
const Searchbar = imports.searchbar;
const Utils = imports.utils;
const WindowMode = imports.windowMode;
const Presentation = imports.presentation;
const Documents = imports.documents;

const _FULLSCREEN_TOOLBAR_TIMEOUT = 2; // seconds

const EvinceView = new Lang.Class({
    Name: 'EvinceView',
    Extends: Preview.Preview,

    _init: function(overlay) {
        this._model = null;
        this._jobFind = null;
        this._controlsFlipId = 0;
        this._controlsVisible = false;
        this._pageChanged = false;
        this._hasSelection = false;
        this._viewSelectionChanged = false;
        this._fsToolbar = null;

        this.parent(overlay);

        Application.modeController.connect('fullscreen-changed', Lang.bind(this,
            this._onFullscreenChanged));
        Application.modeController.connect('window-mode-changed', Lang.bind(this,
            this._onWindowModeChanged));

        // create context menu
        let model = this._getEvinceViewContextMenu();
        this._previewContextMenu = Gtk.Menu.new_from_model(model);
        this._previewContextMenu.attach_to_widget(this.view, null);

        this._bookmarkPage = Application.application.lookup_action('bookmark-page');
        this._bookmarkPage.enabled = false;
        let bookmarkPageId = Application.application.connect('action-state-changed::bookmark-page',
            Lang.bind(this, this._onActionStateChanged));

        this._zoomIn = Application.application.lookup_action('zoom-in');
        let zoomInId = this._zoomIn.connect('activate', Lang.bind(this,
            function() {
                if (!this._model)
                    return;
                this._model.set_sizing_mode(EvView.SizingMode.FREE);
                this._evView.zoom_in();
            }));

        this._zoomOut = Application.application.lookup_action('zoom-out');
        let zoomOutId = this._zoomOut.connect('activate', Lang.bind(this,
            function() {
                if (!this._model)
                    return;
                this._model.set_sizing_mode(EvView.SizingMode.FREE);
                this._evView.zoom_out();
            }));

        this._copy = Application.application.lookup_action('copy');
        let copyId = this._copy.connect('activate', Lang.bind(this,
            function() {
                this._evView.copy();
            }));

        let rotLeft = Application.application.lookup_action('rotate-left');
        let rotLeftId = rotLeft.connect('activate', Lang.bind(this,
            function() {
                this._changeRotation(-90);
            }));
        let rotRight = Application.application.lookup_action('rotate-right');
        let rotRightId = rotRight.connect('activate', Lang.bind(this,
            function() {
                this._changeRotation(90);
            }));
        this._places = Application.application.lookup_action('places');
        let placesId = this._places.connect('activate', Lang.bind(this, this._showPlaces));

        let nightModeId = Application.application.connect('action-state-changed::night-mode',
            Lang.bind(this, this._updateNightMode));

        this._togglePresentation = Application.application.lookup_action('present-current');
        if (!Application.application.isBooks) {
            var presentCurrentId = Application.application.connect('action-state-changed::present-current',
                Lang.bind(this, this._onPresentStateChanged));
        }

        Application.documentManager.connect('load-started',
                                            Lang.bind(this, this._onLoadStarted));
        Application.documentManager.connect('load-error',
                                            Lang.bind(this, this._onLoadError));

        this.connect('destroy', Lang.bind(this,
            function() {
                this._zoomIn.disconnect(zoomInId);
                this._zoomOut.disconnect(zoomOutId);
                this._copy.disconnect(copyId);
                rotLeft.disconnect(rotLeftId);
                rotRight.disconnect(rotRightId);
                this._places.disconnect(placesId);
                if (!Application.application.isBooks)
                    Application.application.disconnect(presentCurrentId);

                Application.application.disconnect(bookmarkPageId);
                Application.application.disconnect(nightModeId);
            }));
    },

    createNavControls: function() {
        return new EvinceViewNavControls(this, this.overlay);
    },

    createView: function() {
        let sw = new Gtk.ScrolledWindow({ hexpand: true,
                                          vexpand: true });
        sw.get_style_context().add_class('documents-scrolledwin');
        sw.get_hscrollbar().connect('button-press-event', Lang.bind(this, this._onScrollbarClick));
        sw.get_vscrollbar().connect('button-press-event', Lang.bind(this, this._onScrollbarClick));
        sw.get_hadjustment().connect('value-changed', Lang.bind(this, this._onAdjustmentChanged));
        sw.get_vadjustment().connect('value-changed', Lang.bind(this, this._onAdjustmentChanged));

        this._evView = EvView.View.new();
        sw.add(this._evView);
        this._evView.show();

        this._evView.connect('notify::can-zoom-in', Lang.bind(this,
            this._onCanZoomInChanged));
        this._evView.connect('notify::can-zoom-out', Lang.bind(this,
            this._onCanZoomOutChanged));
        this._evView.connect('button-press-event', Lang.bind(this,
            this._onButtonPressEvent));
        this._evView.connect('button-release-event', Lang.bind(this,
            this._onButtonReleaseEvent));
        this._evView.connect('selection-changed', Lang.bind(this,
            this._onViewSelectionChanged));
        this._evView.connect('external-link', Lang.bind(this,
            this._handleExternalLink));

        return sw;
    },

    _onLoadStarted: function(manager, doc) {
        if (doc.viewType != Documents.ViewType.EV)
            return;
        this._bookmarkPage.enabled = false;
        this._places.enabled = false;
        this._copy.enabled = false;
    },

    _onLoadError: function(manager, doc, message, exception) {
        if (doc.viewType != Documents.ViewType.EV)
            return;
        this._controlsVisible = true;
        this._syncControlsVisible();
        this.setError(message, exception.message);
    },

    _onActionStateChanged: function(source, actionName, state) {
        if (!this._model)
            return;

        let page_number = this._model.page;
        let bookmark = new GdPrivate.Bookmark({ page_number: page_number });

        if (state.get_boolean())
            this._bookmarks.add(bookmark);
        else
            this._bookmarks.remove(bookmark);
    },

    _onPresentStateChanged: function(source, actionName, state) {
        if (!this._model)
            return;

        if (state.get_boolean())
            this._promptPresentation();
        else
            this._hidePresentation();
    },

    _onPageChanged: function() {
        this._pageChanged = true;

        if (!this._bookmarks)
            return;

        let page_number = this._model.page;
        let bookmark = new GdPrivate.Bookmark({ page_number: page_number });
        let hasBookmark = (this._bookmarks.find_bookmark(bookmark) != null);

        this._bookmarkPage.change_state(GLib.Variant.new('b', hasBookmark));
    },

    _showPlaces: function() {
        let dialog = new Places.PlacesDialog(this._model, this._bookmarks);
        dialog.connect('response', Lang.bind(this,
            function(widget, response) {
                widget.destroy();
            }));
    },

    _hidePresentation: function() {
        if (this._presentation) {
            this._presentation.close();
            this._presentation = null;
        }

        Application.application.change_action_state('present-current', GLib.Variant.new('b', false));
    },

    _showPresentation: function(output) {
        this._presentation = new Presentation.PresentationWindow(this._model);
        this._presentation.connect('destroy', Lang.bind(this, this._hidePresentation));
        if (output)
            this._presentation.setOutput(output);
    },

    _promptPresentation: function() {
        let outputs = new Presentation.PresentationOutputs();
        if (outputs.list.length < 2) {
            this._showPresentation();
        } else {
            let chooser = new Presentation.PresentationOutputChooser(outputs);
            chooser.connectJS('output-activated', Lang.bind(this,
                function(chooser, output) {
                    if (output) {
                        this._showPresentation(output);
                    } else {
                        this._hidePresentation();
                    }
                }));

        }
    },

    _onViewSelectionChanged: function() {
        let hasSelection = this._evView.get_has_selection();
        this._copy.enabled = hasSelection;

        if (!hasSelection &&
            hasSelection == this._hasSelection) {
            this._viewSelectionChanged = false;
            return;
        }

        this._hasSelection = hasSelection;
        this._viewSelectionChanged = true;
        if (!hasSelection)
            this._cancelControlsFlip();
    },

    _uriRewrite: function(uri) {
        if (uri.substring(0, 3) != 'www.') {
            /* Prepending "http://" when the url is a webpage (starts with
             * "www.").
             */
            uri = 'http://' + uri;
        } else {
            /* Or treating as a file, otherwise.
             * http://en.wikipedia.org/wiki/File_URI_scheme
             */
            let doc = Application.documentManager.getActiveItem();
            let file = Gio.file_new_for_uri(doc.uri);
            let parent = file.get_parent();

            if (parent)
                uri = parent.get_uri() + uri;
            else
                uri = 'file:///' + uri;
        }

        return uri;
    },

    _launchExternalUri: function(widget, action) {
        let uri = action.get_uri();
        let screen = widget.get_screen();
        let context = screen.get_display().get_app_launch_context();

        context.set_screen(screen);
        context.set_timestamp(Gtk.get_current_event_time());

        if (uri.indexOf('://') == -1 && uri.substring(0, 6) != 'mailto:')
            /* We are only interested in treat URLs (ignoring URN and Mailto
             * schemes), which have this syntax scheme:
             * scheme://domain:port/path?query_string#fragment_id
             *
             * So, if the url is bad formed (doesn't contain "://"), we need to
             * rewrite it.
             *
             * An example of URL, URN and Mailto schemes can be found in:
             * http://en.wikipedia.org/wiki/URI_scheme#Examples
             */
            uri = this._uriRewrite(uri);

        try {
            Gio.AppInfo.launch_default_for_uri(uri, context);
        } catch (e) {
            log('Unable to open external link: ' + e.message);
        }
    },

    _handleExternalLink: function(widget, action) {
        if (action.type == EvDocument.LinkActionType.EXTERNAL_URI)
            this._launchExternalUri(widget, action);
    },

    _onCanZoomInChanged: function() {
        this._zoomIn.enabled = this._evView.can_zoom_in;
    },

    _onCanZoomOutChanged: function() {
        this._zoomOut.enabled = this._evView.can_zoom_out;
    },

    _getEvinceViewContextMenu: function() {
        let builder = new Gtk.Builder();
        builder.add_from_resource('/org/gnome/Documents/ui/preview-context-menu.ui');
        return builder.get_object('preview-context-menu');
    },

    _syncControlsVisible: function() {
        if (this._controlsVisible) {
            if (this._fsToolbar)
                this._fsToolbar.reveal();
        } else {
            if (this._fsToolbar)
                this._fsToolbar.conceal();
        }
    },

    _onWindowModeChanged: function() {
        let windowMode = Application.modeController.getWindowMode();
        if (windowMode != WindowMode.WindowMode.PREVIEW_EV) {
            this.controlsVisible = false;
            this._hidePresentation();
            this.navControls.hide();
        }
    },

    _onFullscreenChanged: function() {
        let fullscreen = Application.modeController.getFullscreen();

        if (fullscreen) {
            // create fullscreen toolbar (hidden by default)
            this._fsToolbar = new EvinceViewFullscreenToolbar(this);
            this._fsToolbar.setModel(this._model);
            this.overlay.add_overlay(this._fsToolbar);

            this._fsToolbar.connectJS('show-controls', Lang.bind(this,
                function() {
                    this.controlsVisible = true;
                }));
        } else {
            this._fsToolbar.destroy();
            this._fsToolbar = null;
        }

        this._syncControlsVisible();
    },

    _flipControlsTimeout: function() {
        this._controlsFlipId = 0;
        let visible = this.controlsVisible;
        this.controlsVisible = !visible;

        return false;
    },

     _cancelControlsFlip: function() {
         if (this._controlsFlipId != 0) {
             Mainloop.source_remove(this._controlsFlipId);
             this._controlsFlipId = 0;
         }
     },

     _queueControlsFlip: function() {
         if (this._controlsFlipId)
             return;

         let settings = Gtk.Settings.get_default();
         let doubleClick = settings.gtk_double_click_time;

         this._controlsFlipId = Mainloop.timeout_add(doubleClick, Lang.bind(this, this._flipControlsTimeout));
     },

    _onButtonPressEvent: function(widget, event) {
        let button = event.get_button()[1];

        if (button == 3) {
            let time = event.get_time();
            this._previewContextMenu.popup(null, null, null, button, time);
            return true;
        }

        this._viewSelectionChanged = false;
        return false;
   },

    _onButtonReleaseEvent: function(widget, event) {
        let button = event.get_button()[1];
        let clickCount = event.get_click_count()[1];

        if (button == 1
            && clickCount == 1
            && !this._viewSelectionChanged)
            this._queueControlsFlip();
        else
            this._cancelControlsFlip();

        this._viewSelectionChanged = false;

        return false;
    },

    _onScrollbarClick: function() {
        this.controlsVisible = false;
        return false;
    },

    _onAdjustmentChanged: function() {
        if (!this._pageChanged)
            this.controlsVisible = false;
        this._pageChanged = false;
    },

    _changeRotation: function(offset) {
        let rotation = this._model.get_rotation();
        this._model.set_rotation(rotation + offset);
    },

    get controlsVisible() {
        return this._controlsVisible;
    },

    set controlsVisible(visible) {
        // reset any pending timeout, as we're about to change controls state
        this._cancelControlsFlip();

        if (this._controlsVisible == visible)
            return;

        this._controlsVisible = visible;
        this._syncControlsVisible();
    },

    activateResult: function() {
        this.findNext();
    },

    search: function(str) {
        if (!this._model)
            return;

        this.parent(str);

        if (this._jobFind) {
            if (!this._jobFind.is_finished())
                this._jobFind.cancel();
            this._jobFind = null;
        }

        if (!str) {
            this._evView.queue_draw();
            return;
        }

        let evDoc = this._model.get_document();
        this._jobFind = EvView.JobFind.new(evDoc, this._model.get_page(), evDoc.get_n_pages(),
                                           str, false);
        this._jobFind.connect('updated', Lang.bind(this, this._onSearchJobUpdated));

        this._jobFind.scheduler_push_job(EvView.JobPriority.PRIORITY_NONE);
    },

    _onSearchJobUpdated: function(job, page) {
        // FIXME: ev_job_find_get_results() returns a GList **
        // and thus is not introspectable
        GdPrivate.ev_view_find_changed(this._evView, job, page);
        this.emitJS('search-changed', job.has_results());
    },

    reset: function() {
        this.setModel(null);
        this.view.destroy();
        this.navControls.destroy();

        this.view = this.createView();
        this.add_named(this.view, 'view');
        this.set_visible_child_full('view', Gtk.StackTransitionType.NONE);

        this.navControls = this.createNavControls();
        this.show_all();
    },

    setModel: function(model) {
        if (this._model == model)
            return;

        if (this._evView) {
            this.controlsVisible = false;
            this._lastSearch = '';
        }

        this._model = model;

        if (this._model) {
            this._evView.set_model(this._model);
            this.navControls.setModel(model);
            this.navControls.show();
            if (this._togglePresentation)
                this._togglePresentation.enabled = true;

            if (Application.documentManager.metadata)
                this._bookmarks = new GdPrivate.Bookmarks({ metadata: Application.documentManager.metadata });

            let hasMultiplePages = (this._model.document.get_n_pages() > 1);
            this._bookmarkPage.enabled = hasMultiplePages && this._bookmarks;
            this._places.enabled = hasMultiplePages;

            this._model.connect('page-changed', Lang.bind(this, this._onPageChanged));
            this._onPageChanged();

            this._updateNightMode();

            this.set_visible_child_full('view', Gtk.StackTransitionType.NONE);
        } else {
	    if (this._jobFind) {
	        if (!this._jobFind.is_finished())
	            this._jobFind.cancel();
	        this._jobFind = null;
	    }
        }
    },

    _updateNightMode: function() {
        if (this._model && !Application.application.isBooks) {
            let nightMode = Application.settings.get_boolean('night-mode');
            this._model.set_inverted_colors(nightMode);
        }
    },

    getModel: function() {
        return this._model;
    },

    getFullscreenToolbar: function() {
        return this._fsToolbar;
    },

    goPrev: function() {
        this._evView.previous_page();
    },

    goNext: function() {
        this._evView.next_page();
    },

    get hasPages() {
        return this._model ? (this._model.document.get_n_pages() > 0) : false;
    },

    get page() {
        return this._model ? this._model.page : 0;
    },

    get numPages() {
        return this._model ? this._model.document.get_n_pages() : 0;
    },

    findPrev: function() {
        this._evView.find_previous();
    },

    findNext: function() {
        this._evView.find_next();
    },

    get evView() {
        return this._evView;
    }
});
Utils.addJSSignalMethods(EvinceView.prototype);

const EvinceViewNavControls = new Lang.Class({
    Name: 'EvinceViewNavControls',
    Extends: Preview.PreviewNavControls,

    _init: function(previewView, overlay) {
        this._pageChangedId = 0;

        this._previewView = previewView;
        this._model = previewView.getModel();

        this.parent(previewView, overlay);
    },

    createBarWidget: function() {
        let barWidget = new GdPrivate.NavBar({ document_model: this._model,
                                               margin: Preview.PREVIEW_NAVBAR_MARGIN,
                                               valign: Gtk.Align.END,
                                               opacity: 0 });

        let buttonArea = barWidget.get_button_area();

        let button = new Gtk.Button({ action_name: 'app.places',
                                      image: new Gtk.Image({ icon_name: 'view-list-symbolic',
                                                             pixel_size: 16 }),
                                      valign: Gtk.Align.CENTER,
                                      tooltip_text: _("Bookmarks")
                                    });
        buttonArea.pack_start(button, false, false, 0);

        button = new Gtk.ToggleButton({ action_name: 'app.bookmark-page',
                                        image: new Gtk.Image({ icon_name: 'bookmark-new-symbolic',
                                                               pixel_size: 16 }),
                                        valign: Gtk.Align.CENTER,
                                        tooltip_text: _("Bookmark this page")
                                      });
        buttonArea.pack_start(button, false, false, 0);

        return barWidget;
    },

    setModel: function(model) {
        if (this._pageChangedId != 0) {
            this._model.disconnect(this._pageChangedId);
            this._pageChangedId = 0;
        }

        this._model = model;
        this.bar_widget.document_model = model;

        if (this._model)
            this._pageChangedId = this._model.connect('page-changed', Lang.bind(this, this._updateVisibility));
    }
});

const EvinceViewToolbar = new Lang.Class({
    Name: 'EvinceViewToolbar',
    Extends: MainToolbar.MainToolbar,

    _init: function(previewView) {
        this._previewView = previewView;

        this.parent();
        this.toolbar.set_show_close_button(true);

        this._handleEvent = false;
        this._model = null;

        this._searchAction = Application.application.lookup_action('search');
        this._searchAction.enabled = false;

        this._gearMenu = Application.application.lookup_action('gear-menu');
        this._gearMenu.enabled = false;

        // back button, on the left of the toolbar
        let backButton = this.addBackButton();
        backButton.connect('clicked', Lang.bind(this,
            function() {
                Application.documentManager.setActiveItem(null);
                Application.modeController.goBack();
                this._searchAction.enabled = true;
            }));

        // menu button, on the right of the toolbar
        let previewMenu = this._getEvinceViewMenu();
        let menuButton = new Gtk.MenuButton({ image: new Gtk.Image ({ icon_name: 'open-menu-symbolic' }),
                                              menu_model: previewMenu,
                                              action_name: 'app.gear-menu' });
        this.toolbar.pack_end(menuButton);

        // search button, on the right of the toolbar
        this.addSearchButton();
        if (Application.application.isBooks) {
            this.addFullscreenButton();
            this.addNightmodeButton();
        }

        this._setToolbarTitle();
        this.toolbar.show_all();

        this.connect('destroy', Lang.bind(this,
            function() {
                this._searchAction.enabled = true;
            }));
    },

    _enableSearch: function() {
        if (!this._model)
            return;

        let isFind = true;

        try {
            // This is a hack to find out if evDoc implements the
            // EvDocument.DocumentFind interface or not. We don't expect
            // the following invocation to work.
            let evDoc = this._model.get_document();
            evDoc.find_text();
        } catch (e if e instanceof TypeError) {
            isFind = false;
        } catch (e) {
        }

        this._handleEvent = (this._previewView.hasPages && isFind);
        this._searchAction.enabled = (this._previewView.hasPages && isFind);
    },

    _getEvinceViewMenu: function() {
        let builder = new Gtk.Builder();
        builder.add_from_resource('/org/gnome/Documents/ui/preview-menu.ui');
        let menu = builder.get_object('preview-menu');

        let doc = Application.documentManager.getActiveItem();
        if (doc && doc.defaultAppName) {
            let section = builder.get_object('open-section');
            section.remove(0);
            section.prepend(_("Open with %s").format(doc.defaultAppName), 'app.open-current');
        }

        return menu;
    },

    createSearchbar: function() {
        return new EvinceViewSearchbar(this._previewView);
    },

    _setToolbarTitle: function() {
        let primary = null;
        let doc = Application.documentManager.getActiveItem();

        if (doc)
            primary = doc.name;

        this.toolbar.set_title(primary);
    },

    setModel: function(model) {
        if (!model)
            return;

        this._model = model;
        this._gearMenu.enabled = true;
        this._enableSearch();
        this._setToolbarTitle();
    }
});

const EvinceViewSearchbar = new Lang.Class({
    Name: 'EvinceViewSearchbar',
    Extends: Preview.PreviewSearchbar,

    _init: function(preview) {
        this.parent(preview);

        this.preview.connectJS('search-changed', Lang.bind(this, this._onSearchChanged));
        this._onSearchChanged(this.preview, false);
    },

    _onSearchChanged: function(view, hasResults) {
        let findPrev = Application.application.lookup_action('find-prev');
        let findNext = Application.application.lookup_action('find-next');
        findPrev.enabled = hasResults;
        findNext.enabled = hasResults;
    },

    entryChanged: function() {
        this.preview.evView.find_search_changed();
        this.parent();
    },

    reveal: function() {
        this.preview.evView.find_set_highlight_search(true);
        this.parent();
    },

    conceal: function() {
        this.preview.evView.find_set_highlight_search(false);
        this.parent();
    }
});

const EvinceViewFullscreenToolbar = new Lang.Class({
    Name: 'EvinceViewFullscreenToolbar',
    Extends: Gtk.Revealer,

    _init: function(previewView) {
        this.parent({ valign: Gtk.Align.START });

        this._toolbar = new EvinceViewToolbar(previewView);

        this.add(this._toolbar);
        this.show();

        // make controls show when a toolbar action is activated in fullscreen
        let actionNames = ['gear-menu', 'search'];
        let signalIds = [];

        actionNames.forEach(Lang.bind(this,
            function(actionName) {
                let signalName = 'action-state-changed::' + actionName;
                let signalId = Application.application.connect(signalName, Lang.bind(this,
                    function(actionGroup, actionName, value) {
                        let state = value.get_boolean();
                        if (state)
                            this.emitJS('show-controls');
                    }));

                signalIds.push(signalId);
            }));

        this._toolbar.connect('destroy', Lang.bind(this,
            function() {
                signalIds.forEach(
                    function(signalId) {
                        Application.application.disconnect(signalId);
                    });
            }));
    },

    handleEvent: function(event) {
        this._toolbar.handleEvent(event);
    },

    setModel: function(model) {
        this._toolbar.setModel(model);
    },

    reveal: function() {
        this.set_reveal_child(true);
    },

    conceal: function() {
        this.set_reveal_child(false);
        Application.application.change_action_state('search', GLib.Variant.new('b', false));
    }
});
Utils.addJSSignalMethods(EvinceViewFullscreenToolbar.prototype);