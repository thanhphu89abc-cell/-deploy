<?php
ob_start();

ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

header('Content-Type: application/json; charset=utf-8');

/**
 * GLOBAL EXCEPTION HANDLER
 */
set_exception_handler(function (Throwable $e) {

    if (ob_get_level()) {
        ob_clean();
    }

    http_response_code(500);

    echo json_encode([
        "status" => "error",
        "message" => "Lỗi máy chủ nội bộ.",
        "debug" => $e->getMessage()
    ], JSON_UNESCAPED_UNICODE);

    exit;
});

/**
 * FATAL ERROR HANDLER
 */
register_shutdown_function(function () {

    $error = error_get_last();

    if (
        $error !== null &&
        in_array($error['type'], [
            E_ERROR,
            E_PARSE,
            E_CORE_ERROR,
            E_COMPILE_ERROR
        ])
    ) {

        if (ob_get_level()) {
            ob_clean();
        }

        http_response_code(500);

        echo json_encode([
            "status" => "error",
            "message" => "PHP Fatal Error.",
            "debug" => $error['message']
        ], JSON_UNESCAPED_UNICODE);

        exit;
    }
});

/**
 * DATABASE
 */
require 'db_connect.php';

/** @var mysqli $conn */

if (!$conn || $conn->connect_error) {

    http_response_code(500);

    echo json_encode([
        "status" => "error",
        "message" => "Không thể kết nối cơ sở dữ liệu."
    ], JSON_UNESCAPED_UNICODE);

    exit;
}

/**
 * GET INPUT
 */
$input = json_decode(file_get_contents('php://input'), true);

if (!is_array($input)) {
    $input = [];
}

$username = trim($input['fullname'] ?? ($_POST['fullname'] ?? ''));
$email    = trim($input['email'] ?? ($_POST['email'] ?? ''));
$password = $input['password'] ?? ($_POST['password'] ?? '');

/**
 * VALIDATION
 */
if (empty($username) || empty($email) || empty($password)) {

    http_response_code(400);

    echo json_encode([
        "status" => "error",
        "message" => "Vui lòng điền đầy đủ thông tin."
    ], JSON_UNESCAPED_UNICODE);

    exit;
}

/**
 * VALIDATE EMAIL
 */
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {

    http_response_code(400);

    echo json_encode([
        "status" => "error",
        "message" => "Email không hợp lệ."
    ], JSON_UNESCAPED_UNICODE);

    exit;
}

/**
 * PASSWORD LENGTH
 */
if (strlen($password) < 6) {

    http_response_code(400);

    echo json_encode([
        "status" => "error",
        "message" => "Mật khẩu phải từ 6 ký tự trở lên."
    ], JSON_UNESCAPED_UNICODE);

    exit;
}

/**
 * HASH PASSWORD
 */
$hashedPassword = password_hash($password, PASSWORD_DEFAULT);

/**
 * CHECK EMAIL EXISTS
 */
$stmt = $conn->prepare("SELECT id FROM users WHERE email = ?");

if (!$stmt) {

    throw new Exception("Prepare SELECT failed: " . $conn->error);
}

$stmt->bind_param("s", $email);

if (!$stmt->execute()) {

    throw new Exception("Execute SELECT failed: " . $stmt->error);
}

$stmt->store_result();

if ($stmt->num_rows > 0) {

    $stmt->close();

    http_response_code(409);

    echo json_encode([
        "status" => "error",
        "message" => "Email đã được đăng ký."
    ], JSON_UNESCAPED_UNICODE);

    exit;
}

$stmt->close();

/**
 * INSERT USER
 */
$stmt_insert = $conn->prepare("
    INSERT INTO users (
        fullname,
        email,
        password_hash,
        role
    )
    VALUES (?, ?, ?, 'student')
");

if (!$stmt_insert) {

    throw new Exception("Prepare INSERT failed: " . $conn->error);
}

$stmt_insert->bind_param(
    "sss",
    $username,
    $email,
    $hashedPassword
);

if ($stmt_insert->execute()) {

    http_response_code(201);

    $response = [
        "status" => "success",
        "message" => "Đăng ký thành công."
    ];

} else {

    http_response_code(500);

    $response = [
        "status" => "error",
        "message" => "Không thể tạo tài khoản."
    ];
}

$stmt_insert->close();

$conn->close();

/**
 * CLEAN BUFFER
 */
if (ob_get_level()) {
    ob_clean();
}

/**
 * OUTPUT JSON
 */
echo json_encode(
    $response,
    JSON_UNESCAPED_UNICODE
);

exit;