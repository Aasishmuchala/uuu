"""Runs the bench's web server for this Mac only.

`bench serve` always listens on every network interface, which would put the
books' login page on the local network. This starts the same server the same
way (frappe.app.serve) with two differences: it listens on 127.0.0.1 only, and
the in-browser debugger is off.

install.sh copies this file into the bench folder; the Procfile runs it there
with the bench's own Python:  env/bin/python serve_local.py <port> <site>
"""
import os
import sys


def main():
    port = int(sys.argv[1])
    site = sys.argv[2]  # every request is served as this site, whatever host name it used
    bench = os.path.dirname(os.path.abspath(__file__))
    os.chdir(os.path.join(bench, "sites"))

    import werkzeug.serving as serving

    run_simple = serving.run_simple

    def run_local(hostname, port, application, **options):
        options["use_debugger"] = False
        options["use_evalex"] = False
        return run_simple("127.0.0.1", port, application, **options)

    # frappe.app.serve looks run_simple up when it is called, so it gets this one.
    serving.run_simple = run_local

    import frappe.app

    frappe.app.serve(port=port, no_reload=True, site=site, sites_path=".")


if __name__ == "__main__":
    main()
