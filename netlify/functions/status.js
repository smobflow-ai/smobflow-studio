exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const BYTEPLUS_API_KEY = process.env.BYTEPLUS_API_KEY;
  const ENDPOINT = "https://ark.ap-southeast-1.bytepluses.com/api/v3/contents/generations/tasks";

  const taskId = event.queryStringParameters?.task_id;

  if (!taskId) {
    return { statusCode: 400, body: JSON.stringify({ error: "task_id is required." }) };
  }

  try {
    const pollRes = await fetch(`${ENDPOINT}/${taskId}`, {
      headers: { Authorization: `Bearer ${BYTEPLUS_API_KEY}` },
    });

    const pollData = await pollRes.json();
    const status =
      pollData?.data?.status ||
      pollData?.status ||
      pollData?.data?.task_status;

    if (["succeeded", "completed", "Success", "success"].includes(status)) {
      const videoUrl =
        pollData?.data?.video_url ||
        pollData?.data?.output?.video_url ||
        pollData?.data?.videos?.[0]?.url ||
        pollData?.video_url;

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed", video_url: videoUrl }),
      };
    }

    if (["failed", "Failed", "error"].includes(status)) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "failed" }),
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "processing" }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error: " + err.message }),
    };
  }
};