project(
  'gnome-documents', 'c',
  version: '3.27.1',
  license: 'GPL2+',
  default_options: [
    'buildtype=debugoptimized',
    'warning_level=1'
  ],
  meson_version: '>= 0.42.0'
)

documents_version = meson.project_version()

documents_api_version = '1.0'
documents_gir_version = '1.0'

documents_prefix = get_option('prefix')
documents_bindir = join_paths(documents_prefix, get_option('bindir'))
documents_datadir = join_paths(documents_prefix, get_option('datadir'))
documents_libdir = join_paths(documents_prefix, get_option('libdir'))
documents_mandir = join_paths(documents_prefix, get_option('mandir'))

documents_pkgdatadir = join_paths(documents_datadir, meson.project_name())
documents_pkglibdir = join_paths(documents_libdir, meson.project_name())

documents_desktopdir = join_paths(documents_datadir, 'applications')
documents_icondir = join_paths(documents_datadir, 'icons')
documents_schemadir = join_paths(documents_datadir, 'glib-2.0', 'schemas')

documents_debug = get_option('buildtype').contains('debug')

cc = meson.get_compiler('c')

config_h = configuration_data()

# defines
set_defines = [
  # package
  ['PACKAGE', meson.project_name()],
  ['PACKAGE_BUGREPORT', 'http://bugzilla.gnome.org/enter_bug.cgi?product=' + meson.project_name()],
  ['PACKAGE_NAME', meson.project_name()],
  ['PACKAGE_STRING', '@0@ @1@'.format(meson.project_name(), documents_version)],
  ['PACKAGE_TARNAME', meson.project_name()],
  ['PACKAGE_URL', 'https://wiki.gnome.org/Apps/Documents'],
  ['PACKAGE_VERSION', documents_version],
  ['VERSION', documents_version],
  # i18n
  ['GETTEXT_PACKAGE', meson.project_name()]
]

foreach define: set_defines
  config_h.set_quoted(define[0], define[1])
endforeach

# debug options
config_h.set('NDEBUG', not documents_debug)

# headers
check_headers = [
  ['HAVE_DLFCN_H', 'dlfcn.h'],
  ['HAVE_INTTYPES_H', 'inttypes.h'],
  ['HAVE_MEMORY_H', 'memory.h'],
  ['HAVE_STDINT_H', 'stdint.h'],
  ['HAVE_STDLIB_H', 'stdlib.h'],
  ['HAVE_STRINGS_H', 'strings.h'],
  ['HAVE_STRING_H', 'string.h'],
  ['HAVE_SYS_STAT_H', 'sys/stat.h'],
  ['HAVE_SYS_TYPES_H', 'sys/types.h'],
  ['HAVE_UNISTD_H', 'unistd.h']
]

foreach header: check_headers
  config_h.set(header[0], cc.has_header(header[1]))
endforeach

# functions
check_functions = [
  # i18n
  ['HAVE_DCGETTEXT', 'dcgettext'],
  ['HAVE_GETTEXT', 'gettext'],
  ['HAVE_ICONV', 'iconv']
]

if host_machine.system().contains('darwin')
  check_functions += [
    ['HAVE_CFLOCALECOPYCURRENT', 'CFLocaleCopyCurrent'],
    ['HAVE_CFPREFERENCESCOPYAPPVALUE', 'CFPreferencesCopyAppValue']
  ]
endif

foreach func: check_functions
  config_h.set(func[0], cc.has_function(func[1]))
endforeach

# compiler flags
add_project_arguments('-DHAVE_CONFIG_H', language: 'c')

evince_req_version = '>= 3.13.3'
tracker_req_version = '>= 0.17.3'

gjs_dep = dependency('gjs-1.0', version: '>= 1.48.0')
gjs_console = gjs_dep.get_pkgconfig_variable('gjs_console')

documents_deps = [
  gjs_dep,
  dependency('evince-document-3.0', version: evince_req_version),
  dependency('evince-view-3.0', version: evince_req_version),
  dependency('glib-2.0', version: '>= 2.39.3'),
  dependency('gnome-desktop-3.0'),
  dependency('gobject-introspection-1.0', version: '>= 1.31.6'),
  dependency('gtk+-3.0', version: '>= 3.22.15'),
  dependency('libsoup-2.4', version: '>= 2.41.3'),
  dependency('tracker-control-2.0', version: tracker_req_version),
  dependency('tracker-sparql-2.0', version: tracker_req_version),
  dependency('webkit2gtk-4.0', version: '>= 2.6.0'),
  cc.find_library('m')
]

# we just check their existence for gir
dependency('libgdata')
dependency('goa-1.0')
dependency('zapojit-0.0')

# Although GTK+ 3.10 includes hi-dpi functionality, it does not require a cairo with
# cairo_surface_set_device_scale(), which we also need if we're to support hi-dpi,
# so we need check for that explicity.
config_h.set(
  'HAVE_CAIRO_SURFACE_SET_DEVICE_SCALE',
  cc.has_function('cairo_surface_set_device_scale', dependencies: documents_deps)
)

libgd = subproject(
  'libgd',
  default_options: [
    'pkgdatadir=' + documents_pkgdatadir,
    'pkglibdir=' + documents_pkglibdir,
    'static=false',
    'with-gtk-hacks=true',
    'with-introspection=true',
    'with-main-view=true',
    'with-notification=true',
    'with-tagged-entry=true',
    'with-view-common=true'
  ]
)
documents_deps += libgd.get_variable('libgd_dep')

configure_file(
  output: 'config.h',
  configuration: config_h
)

gnome = import('gnome')
i18n = import('i18n')
pkg = import('pkgconfig')

po_dir = join_paths(meson.source_root(), 'po')

top_inc = include_directories('.')

subdir('help')
subdir('src')
subdir('data')
subdir('po')

if get_option('enable-documentation')
  subdir('man')
endif

if get_option('enable-getting-started')
  subdir('getting-started')
endif

meson.add_install_script(
  'meson_post_install.py',
  documents_datadir,
  documents_bindir
)

output = '\n        ' + meson.project_name() + ' ' + documents_version + '\n'
output += '        ======================\n\n'
output += '        prefix:    ' + documents_prefix + '\n'
output += '        compiler:  ' + cc.get_id() + '\n'
message(output)
