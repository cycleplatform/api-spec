#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status.
set -e
# Treat unset variables as an error when substituting.
# set -u # Uncomment if you want stricter variable checking
# Pipe commands should exit with the status of the last command to exit non-zero.
set -o pipefail

# --- Configuration ---
DIST_DIR="./dist"
API_TYPES=("platform" "internal" "scheduler" "ial") # Base names for yml files and reports

# --- Helper Functions ---
log_info() {
    echo "INFO: $1"
}

log_error() {
    echo "ERROR: $1" >&2
}

# --- Main Script ---

# 1. Find and checkout the last v* tag
log_info "Finding the latest tag starting with 'v'..."
# Sort tags using version sort (handles v1.0.0, v1.10.0, v1.2.0 correctly)
# If multiple tags have the same version number (e.g., v1.0.0, v1.0.0-rc1),
# version:refname usually puts the final release last.
LATEST_V_TAG=$(git tag -l "v*" --sort=version:refname | tail -n 1)

if [ -z "$LATEST_V_TAG" ]; then
    log_error "No tags starting with 'v' found. Exiting."
    exit 1
fi

log_info "Checking out latest v* tag: $LATEST_V_TAG"
git checkout "$LATEST_V_TAG"

# 2. Run build on the tag
log_info "Running 'npm run build' on tag $LATEST_V_TAG..."
npm run build

# Check if dist directory exists after build
if [ ! -d "$DIST_DIR" ]; then
    log_error "$DIST_DIR directory not found after building tag $LATEST_V_TAG. Exiting."
    exit 1
fi

# 3. Rename .yml files in dist
log_info "Renaming .yml files in $DIST_DIR to *-prev.yml..."
shopt -s nullglob # Prevent loop from running if no files match
found_yml=false
for file in "$DIST_DIR"/*.yml; do
    # Check if it's a regular file before processing
    if [ -f "$file" ]; then
        base_name=$(basename "$file" .yml)
        dir_name=$(dirname "$file")
        new_name="${dir_name}/${base_name}-prev.yml"
        log_info "  Renaming '$file' to '$new_name'"
        mv "$file" "$new_name"
        found_yml=true
    fi
done
shopt -u nullglob # Turn off nullglob

if ! $found_yml; then
    log_info "No .yml files found in $DIST_DIR to rename."
    # Decide if this is an error or just informational.
    # For now, continue, but you might want to exit 1 here depending on requirements.
fi

# 4. Checkout main and build again
log_info "Checking out main branch..."
git checkout main

log_info "Running 'npm run build' on main branch..."
npm run build

# Check if dist directory exists after build
if [ ! -d "$DIST_DIR" ]; then
    log_error "$DIST_DIR directory not found after building main branch. Exiting."
    exit 1
fi

# 5. Run Docker comparisons
log_info "Running OpenAPI comparisons using Docker..."

for api_type in "${API_TYPES[@]}"; do
    log_info "--- Comparing $api_type APIs ---"
    prev_file="${DIST_DIR}/${api_type}-prev.yml"
    current_file="${DIST_DIR}/${api_type}.yml"
    report_file="${DIST_DIR}/${api_type}-api-report.html"

    # Check if required files exist
    if [ ! -f "$prev_file" ]; then
        log_error "Previous spec file '$prev_file' not found. Skipping comparison for '$api_type'."
        continue # Skip to the next api_type
    fi
     if [ ! -f "$current_file" ]; then
        log_error "Current spec file '$current_file' not found. Skipping comparison for '$api_type'."
        continue # Skip to the next api_type
    fi

    # Construct paths relative to /work inside the container
    # Use parameter expansion ${VAR#./} to remove potential leading ./
    container_prev_file="/work/${prev_file#./}"
    container_current_file="/work/${current_file#./}"
    container_report_file="/work/${report_file#./}"

    log_info "Running Docker comparison for '$api_type':"
    log_info "  Previous: $prev_file"
    log_info "  Current:  $current_file"
    log_info "  Report:   $report_file"

    # Use PWD for clarity and robustness, although '.' often works too.
    docker run --rm -v "$PWD:/work:rw" \
      pb33f/openapi-changes html-report \
      --no-logo \
      --report-file="$container_report_file" \
      "$container_prev_file" \
      "$container_current_file"

    # Optional: Check Docker exit code if set -e is not used or for specific handling
    # docker_exit_code=$?
    # if [ $docker_exit_code -ne 0 ]; then
    #     log_error "Docker command failed for '$api_type' with exit code $docker_exit_code."
    #     # Decide whether to continue or exit
    #     # continue
    #     # exit 1
    # fi

    log_info "Comparison report for '$api_type' generated at '$report_file'."
done

log_info "Script finished successfully."
exit 0