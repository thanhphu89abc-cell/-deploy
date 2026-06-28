<?php

declare(strict_types=1);

use Firebase\JWT\JWT;
use Firebase\JWT\Key;

ob_start();

/**
 * JSON HEADER
 */
header('Content-Type: application/json; charset=utf-8');

/**
 * ERROR REPORTING
 */
ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
error_reporting(E_ALL);

/**
 * SAFE JSON RESPONSE
 */
function jsonResponse(array $data, int $code = 200): void
{
    if (!headers_sent()) {
        http_response_code($code);
    }

    while (ob_get_level() > 0) {
        ob_end_clean();
    }

    echo json_encode(
        $data,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
    );

    exit;
}

/**
 * EXCEPTION HANDLER
 */
set_exception_handler(function (Throwable $e) {

    jsonResponse([
        "status" => "error",
        "message" => "PHP Exception",
        "debug" => $e->getMessage(),
        "line" => $e->getLine(),
        "file" => $e->getFile()
    ], 500);
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

        jsonResponse([
            "status" => "error",
            "message" => "PHP Fatal Error",
            "debug" => $error['message'],
            "line" => $error['line'],
            "file" => $error['file']
        ], 500);
    }
});

/**
 * REQUIRE FILES
 */
require_once dirname(__DIR__) . '/db_connect.php';

$autoload = dirname(__DIR__) . '/vendor/autoload.php';

if (!file_exists($autoload)) {

    jsonResponse([
        "status" => "error",
        "message" => "Thiếu vendor/autoload.php"
    ], 500);
}

require_once $autoload;

/** @var mysqli $conn */

if (!isset($conn) || $conn->connect_error) {

    jsonResponse([
        "status" => "error",
        "message" => "Lỗi kết nối database",
        "debug" => $conn->connect_error ?? 'Unknown error'
    ], 500);
}

/**
 * GET AUTH HEADER
 */
$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';

if (
    empty($authHeader) &&
    function_exists('apache_request_headers')
) {

    $headers = apache_request_headers();

    $authHeader =
        $headers['Authorization']
        ?? $headers['authorization']
        ?? '';
}

/**
 * CHECK TOKEN
 */
if (
    !preg_match('/Bearer\s(\S+)/', $authHeader, $matches)
) {

    jsonResponse([
        "status" => "error",
        "message" => "Không tìm thấy token."
    ], 401);
}

try {

    /**
     * JWT DECODE
     */
    $jwt = $matches[1];

    $secret_key = $_ENV['JWT_SECRET_KEY'] ?? '';
    if (empty($secret_key)) throw new Exception("JWT Secret is not configured.");

    $decoded = JWT::decode(
        $jwt,
        new Key($secret_key, 'HS256')
    );

    $user_id = (int) $decoded->user_id;

    /**
     * GET INPUT
     */
    $rawInput = file_get_contents('php://input');

    $input = [];

    if (!empty($rawInput)) {

        $decodedInput = json_decode($rawInput, true);

        if (json_last_error() === JSON_ERROR_NONE) {
            $input = $decodedInput;
        }
    }

    $old_password = trim(
        $input['oldPassword']
        ?? $_POST['oldPassword']
        ?? ''
    );

    $new_password = trim(
        $input['newPassword']
        ?? $_POST['newPassword']
        ?? ''
    );

    /**
     * VALIDATION
     */
    if ($old_password === '' || $new_password === '') {

        jsonResponse([
            "status" => "error",
            "message" => "Vui lòng nhập đầy đủ thông tin!"
        ], 400);
    }

    if (strlen($new_password) < 6) {

        jsonResponse([
            "status" => "error",
            "message" => "Mật khẩu mới phải từ 6 ký tự."
        ], 400);
    }

    /**
     * GET USER
     */
    $stmt = $conn->prepare("
        SELECT password_hash
        FROM users
        WHERE id = ?
        LIMIT 1
    ");

    if (!$stmt) {

        throw new Exception(
            "Prepare failed: " . $conn->error
        );
    }

    $stmt->bind_param("i", $user_id);

    if (!$stmt->execute()) {

        throw new Exception(
            "Execute failed: " . $stmt->error
        );
    }

    $result = $stmt->get_result();

    if (!$result) {

        throw new Exception(
            "Get result failed"
        );
    }

    $user = $result->fetch_assoc();

    $stmt->close();

    /**
     * USER NOT FOUND
     */
    if (!$user) {

        jsonResponse([
            "status" => "error",
            "message" => "Tài khoản không tồn tại!"
        ], 404);
    }

    /**
     * VERIFY PASSWORD
     */
    if (
        !password_verify(
            $old_password,
            $user['password_hash']
        )
    ) {

        jsonResponse([
            "status" => "error",
            "message" => "Mật khẩu cũ không chính xác!"
        ], 400);
    }

    /**
     * HASH NEW PASSWORD
     */
    $new_hashed = password_hash(
        $new_password,
        PASSWORD_DEFAULT
    );

    /**
     * UPDATE PASSWORD
     */
    $update_stmt = $conn->prepare("
        UPDATE users
        SET password_hash = ?
        WHERE id = ?
    ");

    if (!$update_stmt) {

        throw new Exception(
            "Update prepare failed: " . $conn->error
        );
    }

    $update_stmt->bind_param(
        "si",
        $new_hashed,
        $user_id
    );

    if (!$update_stmt->execute()) {

        throw new Exception(
            "Update execute failed: " . $update_stmt->error
        );
    }

    $update_stmt->close();

    $conn->close();

    /**
     * SUCCESS
     */
    jsonResponse([
        "status" => "success",
        "message" => "Thay đổi mật khẩu thành công!"
    ], 200);

} catch (Throwable $e) {

    jsonResponse([
        "status" => "error",
        "message" => "JWT hoặc hệ thống lỗi",
        "debug" => $e->getMessage()
    ], 500);
}